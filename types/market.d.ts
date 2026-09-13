export interface MarketData {
  marketData: Market
  timestamp: number
}

export interface Market {
  [hrid: string]: MarketItem
}

export interface MarketItem {
  [level: string]: MarketItemPrice
}

export interface MarketItemPrice {
  ask: number
  bid: number
  /** 当前价（官方 marketplace 的 p 字段，可能缺省） */
  price?: number
  /** 成交量/贸易量（官方 marketplace 的 v 字段，可能缺省） */
  volume?: number
}

export interface MarketDataPlain {
  marketData: {
    [hrid: string]: {
      [level: string]: {
        a?: number
        b?: number
        p?: number
        v?: number
      }
    }
  }
  timestamp: number
}
