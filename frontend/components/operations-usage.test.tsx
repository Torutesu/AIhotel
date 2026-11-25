import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageReport } from '@shared/types/usage'
const mock=vi.hoisted(()=>({data:{} as UsageReport}))
vi.mock('@/hooks/use-api-query',()=>({useApiQuery:()=>({data:mock.data,loading:false,error:null,reload:vi.fn()})}))
vi.mock('@/components/operations/usage-charts',()=>({UsageDailyChart:()=> <div>日別グラフ</div>,UsageFeatureBars:()=> <div>機能別グラフ</div>}))
import { OperationsUsage } from './operations-usage'
describe('usage UI',()=>{
 beforeEach(()=>{mock.data={source:'trial',generatedAt:'2026-11-25T01:00:00Z',startedAt:'2026-11-25T00:00:00Z',accounts:[{id:'a',name:'確認用ホテル',email:'client@example.test',status:'ACTIVE',lastLoginAt:null,days:[]}]}})
 it('removes detail if the account disappears from authorized results',()=>{
  const {rerender}=render(<OperationsUsage scope="assigned"/>)
  fireEvent.click(screen.getByRole('button',{name:/確認用ホテル/}))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  mock.data={...mock.data,accounts:[]}
  rerender(<OperationsUsage scope="assigned"/>)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('該当する顧客はありません。')).toBeInTheDocument()
 })
 it('explains measured scope and old timestamp limits in the selected client detail',()=>{
  render(<OperationsUsage scope="assigned"/>)
  expect(screen.getByText(/自社に割り当てられたアカウントのみ/)).toBeInTheDocument()
  expect(screen.getByText(/アカウント単位の集計/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:/確認用ホテル/}))
  const dialog=within(screen.getByRole('dialog'))
  expect(dialog.getByRole('heading',{name:'確認用ホテルの活用状況'})).toBeInTheDocument()
  expect(dialog.getByText(/未記録は未利用の断定ではありません/)).toBeInTheDocument()
  expect(dialog.getByText(/時刻付きの操作履歴はまだありません/)).toBeInTheDocument()
  fireEvent.click(dialog.getByRole('button',{name:'詳細を閉じる'}))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
 })
 it('filters and searches client records without pretending there is usage',()=>{
  render(<OperationsUsage/>)
  fireEvent.change(screen.getByLabelText('利用状況で絞り込む'),{target:{value:'active'}})
  expect(screen.getByText('該当する顧客はありません。')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('利用状況で絞り込む'),{target:{value:'noLogin'}})
  expect(screen.getByRole('button',{name:/確認用ホテル/})).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'別の顧客'}})
  expect(screen.queryByRole('button',{name:/確認用ホテル/})).not.toBeInTheDocument()
 })
})
