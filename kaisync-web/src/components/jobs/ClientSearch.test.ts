import { describe, expect, it } from 'vitest'
import { matchClients } from '@/components/jobs/ClientSearch'

const clients = [
  { id: '1', name: 'SOUTH AFRICAN BREWERIES (PTY) LTD (ROSSLYN)', client_code: 'C300033' },
  { id: '2', name: 'SOUTH AFRICAN BREWERIES (PTY) LTD - RUSTENBURG', client_code: 'C300409' },
  { id: '3', name: 'Ironvale Mall', client_code: null, account_number: 'ACC-77' },
]

describe('matchClients', () => {
  it('matches every typed word, any case, in any order', () => {
    expect(matchClients(clients, 'breweries rosslyn').map(c => c.id)).toEqual(['1'])
    expect(matchClients(clients, 'south').map(c => c.id)).toEqual(['1', '2'])
  })
  it('matches client code and account number', () => {
    expect(matchClients(clients, 'c300409').map(c => c.id)).toEqual(['2'])
    expect(matchClients(clients, 'acc-77').map(c => c.id)).toEqual(['3'])
  })
  it('shows everyone when nothing is typed', () => {
    expect(matchClients(clients, '  ')).toHaveLength(3)
  })
})
