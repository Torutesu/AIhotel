import type {
  ConnectorDefinition,
  LincolnDefinition,
  NehoppsDefinition,
  SyncTarget,
} from '@hotel-revenue-system/shared/types'

// 連携定義（セレクタ・操作手順）。エージェントは GET /connector/definitions で
// この定義を取得して解釈するため、対象システムの画面変更時は本ファイルの更新
// （＋backendデプロイ）のみで対応でき、エージェント本体の再配布は不要。
//
// ⚠️ セレクタは現在プレースホルダ。connector-agent/README.md の調査（recon）で
// 採取した実画面のDOMを基に確定させる。writeEnabled は実セレクタ確定＋
// READ連続成功の実績ができるまで false のまま維持すること（§10.1 L3）。

const LINCOLN_DEFINITION: LincolnDefinition = {
  target: 'LINCOLN',
  version: 1,
  writeEnabled: false,
  maintenanceWindows: [],
  login: {
    url: 'https://placeholder.invalid/login', // TODO(recon): 実URLに差し替え
    loggedInSelector: '[data-recon="logged-in"]', // TODO(recon)
    userSelector: 'input[name="userId"]', // TODO(recon)
    passwordSelector: 'input[name="password"]', // TODO(recon)
    submitSelector: 'button[type="submit"]', // TODO(recon)
    errorSelector: '.login-error', // TODO(recon)
  },
  read: {
    url: 'https://placeholder.invalid/price-ranks', // TODO(recon)
    rowSelector: 'table.price-rank tbody tr', // TODO(recon)
    cells: {
      rank: 'td.rank', // TODO(recon)
      label: 'td.label', // TODO(recon)
      price1P: 'td.price-1p', // TODO(recon)
      price2P: 'td.price-2p', // TODO(recon)
      price3P: 'td.price-3p', // TODO(recon)
      price4P: 'td.price-4p', // TODO(recon)
    },
  },
  write: {
    url: 'https://placeholder.invalid/price-ranks/edit', // TODO(recon)
    inputSelectors: {
      price1P: 'input[name="price1p_{rank}"]', // TODO(recon)
      price2P: 'input[name="price2p_{rank}"]', // TODO(recon)
      price3P: 'input[name="price3p_{rank}"]', // TODO(recon)
      price4P: 'input[name="price4p_{rank}"]', // TODO(recon)
    },
    submitSelector: 'button.save', // TODO(recon)
    successSelector: '.save-success', // TODO(recon)
  },
}

const NEHOPPS_DEFINITION: NehoppsDefinition = {
  target: 'NEHOPPS',
  version: 1,
  writeEnabled: false,
  maintenanceWindows: [],
  // UIA調査（connector-agent/README.md）で FlaUI CLI の操作定義を確定してから設定する
  cli: null,
}

const DEFINITIONS: Record<SyncTarget, ConnectorDefinition> = {
  LINCOLN: LINCOLN_DEFINITION,
  NEHOPPS: NEHOPPS_DEFINITION,
}

export function getConnectorDefinition(target: SyncTarget): ConnectorDefinition {
  return DEFINITIONS[target]
}
