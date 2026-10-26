import { describe, expect, it } from 'vitest'
import { imagesEnabled } from '../server/utils/catalogSync'

describe('imagesEnabled', () => {
  it('OData без флага — картинки не качаем', () => {
    expect(imagesEnabled({ onecMock: false, onecMode: 'odata', onecOdataImages: false })).toBe(false)
  })
  it('OData с флагом, HTTP-сервис и мок — качаем', () => {
    expect(imagesEnabled({ onecMock: false, onecMode: 'odata', onecOdataImages: true })).toBe(true)
    expect(imagesEnabled({ onecMock: false, onecMode: 'http', onecOdataImages: false })).toBe(true)
    expect(imagesEnabled({ onecMock: true, onecMode: 'odata', onecOdataImages: false })).toBe(true)
  })
})
