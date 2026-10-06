import { request } from './client';

export type UserTradeFee = {
  symbol: string;
  takerFeeRate: string;
  makerFeeRate: string;
};

export async function fetchUserTradeFees(symbols: string[]): Promise<Record<string, UserTradeFee>> {
  if (symbols.length === 0) return {};
  const symbolsParam = symbols.join(',');
  const response = await request<{ data: UserTradeFee[] }>('/api/v1/trade-fees', {
    query: { symbols: symbolsParam },
    signed: true,
  });
  const fees: Record<string, UserTradeFee> = {};
  for (const fee of response.data) {
    fees[fee.symbol] = fee;
  }
  return fees;
}