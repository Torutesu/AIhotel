import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/hooks/use-api-query', () => ({ useApiQuery: () => ({
  data: { source: 'trial', startedAt: '2026-11-25T00:00:00Z', accounts: [{ id: 'a', name: '確認用ホテル', days: [] }] },
  loading: false, error: null, reload: vi.fn(),
}) }))
import { OperationsUsage } from './operations-usage'
describe('活用状況の表示整合性', () => {
  it('検索から外れた顧客の詳細を残さない', () => {
    render(<OperationsUsage />)
    fireEvent.click(screen.getByRole('button', { name: /確認用ホテル/ }))
    expect(screen.getByRole('heading', { name: '確認用ホテルの活用状況' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '別の顧客' } })
    expect(screen.queryByRole('heading', { name: '確認用ホテルの活用状況' })).not.toBeInTheDocument()
    expect(screen.getByText('該当する顧客はありません。')).toBeInTheDocument()
  })
  it('サンプル業務データと実際の計測、未記録と未利用を区別する', () => {
    render(<OperationsUsage />)
    expect(screen.getByText(/アカウント単位の集計/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /確認用ホテル/ }))
    expect(screen.getByText(/未記録は未利用の断定ではありません/)).toBeInTheDocument()
    expect(screen.getByText(/日付・日時は日本時間です/)).toBeInTheDocument()
  })
})
