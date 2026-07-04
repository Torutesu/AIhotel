// Common utility functions shared between frontend and backend

export function formatCurrency(amount: number, locale: string = 'ja-JP'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'JPY',
  }).format(amount)
}

export function formatDate(date: Date, locale: string = 'ja-JP'): string {
  return new Intl.DateTimeFormat(locale).format(date)
}

export function calculateADR(revenue: number, roomsSold: number): number {
  if (roomsSold === 0) return 0
  return revenue / roomsSold
}

export function calculateOccupancy(roomsSold: number, totalRooms: number): number {
  if (totalRooms === 0) return 0
  return roomsSold / totalRooms
}

export function calculateRevPAR(revenue: number, totalRooms: number): number {
  if (totalRooms === 0) return 0
  return revenue / totalRooms
}

