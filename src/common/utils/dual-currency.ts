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

  // L4: 无效输入必须抛错，防止静默生成零金额记录
  if (isNaN(amt) || isNaN(rate) || rate <= 0) {
    throw new Error(
      `computeDualAmounts: 无效参数 amount=${amount}, exchangeRate=${exchangeRate}`,
    );
  }

  // M2: 严格校验币种，防止 'usd'(小写)、'EUR' 等被静默按 CNY 处理
  if (currency !== 'USD' && currency !== 'CNY') {
    throw new Error(
      `computeDualAmounts: 不支持的币种 "${currency}"，仅支持 USD 或 CNY`,
    );
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

  // L4: 无效输入必须抛错
  if (isNaN(price) || isNaN(rate) || rate <= 0) {
    throw new Error(
      `computeDualUnitPrice: 无效参数 unitPrice=${unitPrice}, exchangeRate=${exchangeRate}`,
    );
  }

  // M2: 严格校验币种
  if (currency !== 'USD' && currency !== 'CNY') {
    throw new Error(
      `computeDualUnitPrice: 不支持的币种 "${currency}"，仅支持 USD 或 CNY`,
    );
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
