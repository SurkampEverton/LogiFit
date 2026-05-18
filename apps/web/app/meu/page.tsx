/**
 * /meu — home do portal do paciente. Sprint 26 Faixa C.
 *
 * Mostra greeting + atalhos pras 4 áreas principais. Cards mobile-first.
 */
import { redirect } from 'next/navigation'
import { pool } from '@repo/db/client'
import Link from 'next/link'
import { requireMemberSession } from '../lib/member-session'

export default async function MyHomePage() {
  const session = await requireMemberSession('/meu')

  // Greeting via persons.name
  const r = await pool.query<{ name: string }>(
    `SELECT p.name FROM members m
     JOIN persons p ON p.id = m.person_id
     WHERE m.id = $1 LIMIT 1`,
    [session.memberId],
  )
  const name = r.rows[0]?.name?.split(' ')[0] ?? ''

  return (
    <div className="ev-portal-page">
      <h1 className="ev-portal-h1">Olá, {name}!</h1>
      <p className="ev-portal-muted">Bem-vindo ao seu portal LogiFit.</p>

      <section className="ev-portal-card-grid">
        <Link href="/meu/agenda" className="ev-portal-card">
          <div className="ev-portal-card-icon">📅</div>
          <div className="ev-portal-card-title">Agenda</div>
          <div className="ev-portal-card-desc">Próximos agendamentos</div>
        </Link>
        <Link href="/meu/financeiro" className="ev-portal-card">
          <div className="ev-portal-card-icon">💳</div>
          <div className="ev-portal-card-title">Financeiro</div>
          <div className="ev-portal-card-desc">Cobranças e recibos</div>
        </Link>
        <Link href="/meu/treino" className="ev-portal-card">
          <div className="ev-portal-card-icon">💪</div>
          <div className="ev-portal-card-title">Treino</div>
          <div className="ev-portal-card-desc">Sua ficha atual</div>
        </Link>
        <Link href="/meu/qr" className="ev-portal-card">
          <div className="ev-portal-card-icon">📱</div>
          <div className="ev-portal-card-title">QR Acesso</div>
          <div className="ev-portal-card-desc">Catraca</div>
        </Link>
        <Link href="/meu/privacidade" className="ev-portal-card">
          <div className="ev-portal-card-icon">🔒</div>
          <div className="ev-portal-card-title">Privacidade</div>
          <div className="ev-portal-card-desc">Seus dados</div>
        </Link>
        <Link href="/meu/perfil" className="ev-portal-card">
          <div className="ev-portal-card-icon">👤</div>
          <div className="ev-portal-card-title">Perfil</div>
          <div className="ev-portal-card-desc">Dados cadastrais</div>
        </Link>
      </section>
    </div>
  )
}
