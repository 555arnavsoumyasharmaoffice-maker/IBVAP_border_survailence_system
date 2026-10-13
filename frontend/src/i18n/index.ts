import { useCallback } from 'react'
import { useUi } from '@/store/ui'
import { en, hi, type DictKey } from './dict'

export type Lang = 'en' | 'hi'

export function translate(lang: Lang, key: DictKey): string {
  return (lang === 'hi' ? hi[key] : undefined) ?? en[key]
}

export function useT() {
  const lang = useUi((s) => s.lang)
  return useCallback((key: DictKey) => translate(lang, key), [lang])
}

export type { DictKey }
