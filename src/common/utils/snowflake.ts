/**
 * Snowflake ID 生成器
 *
 * 结构（64 位）：
 * - 1 bit：符号位（始终为 0）
 * - 41 bits：时间戳（毫秒），可用约 69 年
 * - 10 bits：工作节点 ID（0-1023）
 * - 12 bits：序列号（同一毫秒内递增，0-4095）
 *
 * 生成结果为 string 类型，避免 JavaScript Number 精度丢失
 */

const EPOCH = 1704067200000n // 2024-01-01 00:00:00 UTC
const WORKER_ID = BigInt(process.env.WORKER_ID || '1')
const SEQUENCE_BITS = 12n
const WORKER_ID_BITS = 10n
const TIMESTAMP_SHIFT = SEQUENCE_BITS + WORKER_ID_BITS // 22
const SEQUENCE_MASK = (1n << SEQUENCE_BITS) - 1n // 4095

class SnowflakeGenerator {
  private lastTimestamp = 0n
  private sequence = 0n

  /**
   * 生成下一个唯一 ID
   * @returns 字符串形式的 Snowflake ID
   */
  nextId(): string {
    let timestamp = BigInt(Date.now())

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & SEQUENCE_MASK
      if (this.sequence === 0n) {
        // 当前毫秒序列号用完，等待下一毫秒
        while (timestamp <= this.lastTimestamp) {
          timestamp = BigInt(Date.now())
        }
      }
    } else {
      this.sequence = 0n
    }

    this.lastTimestamp = timestamp

    const id =
      ((timestamp - EPOCH) << TIMESTAMP_SHIFT) |
      (WORKER_ID << SEQUENCE_BITS) |
      this.sequence

    return id.toString()
  }

  /**
   * 从 Snowflake ID 中提取时间戳
   * @param id Snowflake ID 字符串
   * @returns 毫秒时间戳
   */
  extractTimestamp(id: string): number {
    const idBigInt = BigInt(id)
    return Number((idBigInt >> TIMESTAMP_SHIFT) + EPOCH)
  }
}

export const snowflake = new SnowflakeGenerator()
