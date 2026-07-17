/**
 * 双币种计算工具
 * 统一处理 USD/CNY 双币种金额换算
 */

export interface DualAmounts {
  amountUsd: string;
  amountCny: string;
}

/**
 * 根据原币金额和汇率，计算 USD 和 CNY 双币种金额
 * @param amount 原币金额（字符串或数字）
 * @param currency 原币币种 'USD' | 'CNY'
 * @param exchangeRate USD→CNY 汇率
 * @param scale 小数位数，默认 2
 */
export function computeDualAmounts(
  amount: string | number,
  currency: string,
  exchangeRate: string | number,
  scale: number = 2,
): DualAmounts {
  const amt = Number(amount);
  const rate = Number(exchangeRate);

  if (isNaN(amt) || isNaN(rate) || rate <= 0) {
    return { amountUsd: '0', amountCny: '0' };
  }

  if (currency === 'USD') {
    return {
      amountUsd: amt.toFixed(scale),
      amountCny: (amt * rate).toFixed(scale),
    };
  } else {
    // CNY
    return {
      amountUsd: (amt / rate).toFixed(scale),
      amountCny: amt.toFixed(scale),
    };
  }
}

/**
 * 计算双币种单价
 * @param unitPrice 原币单价
 * @param currency 原币币种
 * @param exchangeRate USD→CNY 汇率
 * @param scale 小数位数，默认 2
 */
export function computeDualUnitPrice(
  unitPrice: string | number,
  currency: string,
  exchangeRate: string | number,
  scale: number = 2,
): { unitPriceUsd: string; unitPriceCny: string } {
  const price = Number(unitPrice);
  const rate = Number(exchangeRate);

  if (isNaN(price) || isNaN(rate) || rate <= 0) {
    return { unitPriceUsd: '0', unitPriceCny: '0' };
  }

  if (currency === 'USD') {
    return {
      unitPriceUsd: price.toFixed(scale),
      unitPriceCny: (price * rate).toFixed(scale),
    };
  } else {
    return {
      unitPriceUsd: (price / rate).toFixed(scale),
      unitPriceCny: price.toFixed(scale),
    };
  }
}
