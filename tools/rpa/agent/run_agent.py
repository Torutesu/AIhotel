"""TL-リンカーンの操作をエージェント（browser-use）に任せて、手順とセレクタを持ち帰る（#6）。

構成A（エージェントもブラウザもホテル端末）で動かす前提。

  1. 人がChromeをデバッグポート付きで起動し、手動でTL-リンカーンにログインしておく
  2. このスクリプトが「既に開いているChrome」にCDPで接続する（新しいブラウザは起動しない）
  3. 目的（既定: 予約明細CSVのエクスポート）を実行し、行動履歴をJSONで保存する

ログインをエージェントにさせないのは、パスワードを渡さずに済ませるためと、
MFA・同時ログイン制限に引っかからないようにするため。

出力（すべて --out-dir 配下）:
  history_<時刻>.json  … 何をどう操作したかの記録。selectors.json を書く材料
  result_<時刻>.json   … 最終結果とダウンロード先
  conversation_<時刻>/ … モデルとのやり取り（--save-conversation 指定時）

使い方:
  uv run python run_agent.py --cdp http://127.0.0.1:9222 --days 30
  uv run python run_agent.py --goal "予約検索画面を開いて、出力できる項目の一覧を読み上げる"
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from browser_use import Agent, Browser, ChatOpenAI

# 更新系に触らせないための禁止事項。指示文の先頭に必ず入れる（docs/ハンドオフ_取得自動化.md §5 と対）
GUARDRAILS = """
あなたはホテルの業務用PC上で、すでにログイン済みのブラウザを操作します。

絶対に守ること:
1. 参照とエクスポートのみ行う。在庫・料金・プラン・予約内容を変更する操作は一切しない。
   「更新」「登録」「反映」「送信」「削除」「設定変更」に類するボタンは押さない
   （CSV出力・検索・ダウンロードのためのボタンは除く）。
2. ログアウトしない。パスワードの変更・アカウント設定に触らない。
3. 判断に迷ったら操作を止め、画面の状態を説明して終了する。勝手に別の経路を試さない。
4. 新しいタブでサイト外へ移動しない。今開いているサービスの中だけで完結させる。
5. 個人情報（宿泊者名・連絡先）は報告に書き写さない。列が存在することだけを報告する。
"""

DEFAULT_GOAL = """
予約明細のCSVをエクスポートしてください。手順:
1. 予約検索の画面を開く
2. 期間を「{from_date}」〜「{to_date}」に設定する
3. 検索する
4. CSVエクスポートを実行し、ファイルがダウンロードされたことを確認する

完了したら、次を報告してください（後で決定論的なスクリプトに書き換えるための材料です）:
- クリックした要素の順番と、それぞれの表示名・種類（ボタン/リンク/タブ）
- 入力した項目名と、入力値の書式（とくに日付の書式）
- 各画面のURL
- 待ちが発生した箇所と、完了が分かる目印
- 出たダイアログ・警告の文言（そのまま）
- ダウンロードされたファイル名
"""


def load_env_file() -> None:
    """スクリプトと同じ場所の .env を読む（依存を増やさないための最小実装）。

    既に設定されている環境変数は上書きしない（コマンドラインからの指定を優先する）。
    """
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cdp", default=os.environ.get("CDP_URL", "http://127.0.0.1:9222"),
                        help="接続先のChrome（既定: http://127.0.0.1:9222）")
    parser.add_argument("--goal", default=None, help="目的。省略時は予約明細CSVのエクスポート")
    parser.add_argument("--days", type=int, default=30, help="取得期間（今日から遡る日数）")
    parser.add_argument("--model", default=os.environ.get("AGENT_MODEL", "gpt-5.6-luna"))
    parser.add_argument("--max-steps", type=int, default=25, help="打ち切りまでの手数（暴走を止める）")
    parser.add_argument("--out-dir", default=str(Path(__file__).parent / "out"))
    parser.add_argument("--save-conversation", action="store_true",
                        help="モデルとのやり取りも保存する（画面の内容を含むので取り扱い注意）")
    return parser.parse_args()


def build_task(args: argparse.Namespace) -> str:
    if args.goal:
        return f"{GUARDRAILS}\n\n{args.goal}"
    today = datetime.now()
    from_date = datetime.fromordinal(today.toordinal() - args.days)
    return f"{GUARDRAILS}\n\n" + DEFAULT_GOAL.format(
        from_date=from_date.strftime("%Y/%m/%d"), to_date=today.strftime("%Y/%m/%d")
    )


async def main() -> int:
    load_env_file()
    args = parse_args()
    if not os.environ.get("OPENAI_API_KEY"):
        print("OPENAI_API_KEY が設定されていません（.env か環境変数で渡してください）", file=sys.stderr)
        return 1

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    # 既に開いているChromeに接続する。is_local=True は「同じ端末のブラウザ」の意味で、
    # ダウンロードしたファイルをこの端末のフォルダとして扱えるようにする
    browser = Browser(
        cdp_url=args.cdp,
        is_local=True,
        accept_downloads=True,
        downloads_path=str(out_dir),
    )
    await browser.start()
    print(f"接続しました: {args.cdp} / 現在のページ: {await browser.get_current_page_url()}")

    agent = Agent(
        task=build_task(args),
        llm=ChatOpenAI(model=args.model),
        browser=browser,
        # 画面を見ないと操作できないので vision は有効。ただし個人情報が送られる点は運用で合意すること
        use_vision=True,
        save_conversation_path=str(out_dir / f"conversation_{stamp}") if args.save_conversation else None,
    )

    try:
        history = await agent.run(max_steps=args.max_steps)
    finally:
        # 人が開いたブラウザなので閉じない（ログイン状態を保ったまま次の試行に使う）
        pass

    history_path = out_dir / f"history_{stamp}.json"
    try:
        history.save_to_file(str(history_path))
    except Exception:  # 版により save_to_file が無い場合のフォールバック
        history_path.write_text(json.dumps(str(history), ensure_ascii=False, indent=2), encoding="utf-8")

    # トークン使用量（= 実行コスト）を必ず残す。1回の実測があれば、
    # 「毎日×ホテル数」に伸ばしたときの月額をその場で計算できる
    usage = getattr(history, "usage", None)
    usage_summary = None
    if usage is not None:
        usage_summary = {
            "prompt_tokens": getattr(usage, "total_prompt_tokens", None),
            "prompt_cached_tokens": getattr(usage, "total_prompt_cached_tokens", None),
            "completion_tokens": getattr(usage, "total_completion_tokens", None),
            "total_tokens": getattr(usage, "total_tokens", None),
            # 単価が登録されているモデルなら概算額も入る（入らなければ None）
            "estimated_cost_usd": getattr(usage, "total_cost", None),
            "llm_calls": getattr(usage, "entry_count", None),
        }

    result = {
        "finished_at": datetime.now().isoformat(),
        "final_result": history.final_result(),
        "is_successful": history.is_successful(),
        "urls": [str(u) for u in history.urls()],
        "downloads": [p.name for p in out_dir.glob("*.csv")],
        "steps": history.number_of_steps() if hasattr(history, "number_of_steps") else None,
        "duration_seconds": getattr(history, "total_duration_seconds", lambda: None)()
        if callable(getattr(history, "total_duration_seconds", None))
        else None,
        "usage": usage_summary,
    }
    (out_dir / f"result_{stamp}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps(result, ensure_ascii=False, indent=2))
    print(f"\n行動履歴: {history_path}")
    print("この履歴から selectors.json を埋めて、エージェント無しで同じことができるか確認すること")
    return 0 if result["is_successful"] else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
