import type { DataService } from './types'
import { createMockService } from './mock/mockService'
import { createApiService } from './api/apiService'

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000/api'
export const WS_URL: string = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws'

/** The only data entry point for the UI. Never import from ./mock directly. */
export const service: DataService = USE_MOCK ? createMockService() : createApiService(API_URL, WS_URL)

export type { DataService, AlertQuery, PlateQuery, DemoAlertSpec } from './types'
