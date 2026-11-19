/**
 * Реквизиты поставщика для карточки в «Профиле» (2026-11-19, решение владельца): статичные, без
 * запросов в портал. Только расчётные счета — кредитные клиенту не показываем.
 */
export interface SupplierAccount { account: string, bank: string, bik: string, currency: string }

export const SUPPLIER = {
  name: 'Общество с ограниченной ответственностью "АльгенаЛайт"',
  unp: '291184364',
  address: '225209, Брестская обл., г. Берёза, ул. Комсомольская, 1Б',
  accounts: [
    { account: 'BY20BAPB30127244300100000000', bank: 'ЦБУ № 123 в г. Береза ОАО «Белагропромбанк»', bik: 'BAPBBY2X', currency: 'BYN' },
    { account: 'BY63BLBB30120291184364001001', bank: 'ОАО «Белинвестбанк» ЦБУ №404', bik: 'BLBBBY2X', currency: 'BYN' },
    { account: 'BY06AKBB30120666900101100000', bank: 'ОАО «АСБ Беларусбанк» ЦБУ №106 г. Береза', bik: 'AKBBBY2X', currency: 'BYN' },
    { account: 'BY52BLBB30120291184364001005', bank: 'ОАО «Белинвестбанк» ЦБУ №404', bik: 'BLBBBY2X', currency: 'RUB' },
  ] as SupplierAccount[],
} as const
