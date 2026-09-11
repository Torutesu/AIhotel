"use client"

// OTA販売促進参画データ管理（U-15 で analysis-tab.tsx から分割）。保存APIが未実装。

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CampaignParticipationManager } from "@/components/campaign-participation-manager"
import { SampleDataNotice } from "@/components/sample-data-notice"

export function OtaCampaignSection() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium">OTA販売促進参画データ管理</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <SampleDataNotice detail="OTA販売促進参画データの保存APIが未実装のため、入力内容は保存されません。" />
        <CampaignParticipationManager />
      </CardContent>
    </Card>
  )
}
