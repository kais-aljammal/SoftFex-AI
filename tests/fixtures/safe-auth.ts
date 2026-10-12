export function getUser(req: { params: { id: string } }, db: { query(sql: string, values?: unknown[]): unknown }) {
  return db.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
}
