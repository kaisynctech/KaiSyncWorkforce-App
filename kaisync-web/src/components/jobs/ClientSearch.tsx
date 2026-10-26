'use client'

import { useMemo } from 'react'
import { SearchPicker, matchOptions, type PickerOption } from '@/components/SearchPicker'

export type ClientOption = { id: string; name: string; client_code?: string | null; account_number?: string | null }

function toOption(c: ClientOption): PickerOption {
  return { id: c.id, label: c.name, detail: c.client_code, keywords: c.account_number }
}

/** Every typed word must appear in the name, client code or account number ("sab ross" finds SAB Rosslyn). */
export function matchClients(clients: ClientOption[], query: string): ClientOption[] {
  const ids = new Set(matchOptions(clients.map(toOption), query).map(o => o.id))
  return clients.filter(c => ids.has(c.id))
}

type Props = {
  clients: ClientOption[]
  value: string
  onChange: (clientId: string) => void
  label?: string
  disabled?: boolean
}

/** Type-to-search client picker for long client lists (hundreds of clients). */
export function ClientSearch({ clients, value, onChange, label = 'Client', disabled }: Props) {
  const options = useMemo(() => clients.map(toOption), [clients])
  return (
    <SearchPicker options={options} value={value} onChange={onChange} label={label} noun="client" disabled={disabled}
      placeholder={`Type a client name or code (${clients.length.toLocaleString()} client${clients.length === 1 ? '' : 's'})…`} />
  )
}
