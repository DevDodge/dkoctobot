const { Client } = require('pg')
async function main() {
    const c = new Client({
        host: 'localhost',
        port: 10034,
        user: 'postgres',
        password: 'Eng.OctoBot-DK-Kareem-DODGE.12',
        database: 'dk_octobot'
    })
    await c.connect()
    const r = await c.query('SELECT id, name FROM chat_flow')
    r.rows.forEach((row) => console.log(row.id + ' | ' + row.name))
    await c.end()
}
main().catch(console.error)
