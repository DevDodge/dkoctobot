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

    const r = await c.query(`
        SELECT id, name, 
        CASE WHEN "flowData"::text LIKE '%grok-4.1-fast%' THEN 'YES' ELSE 'NO' END as has_old_model
        FROM chat_flow
    `)

    console.log('Total chatflows:', r.rows.length)
    console.log('---')
    r.rows.forEach((row) => console.log(row.has_old_model + ' | ' + row.name + ' | ' + row.id))
    console.log('---')
    console.log('Affected (contain grok-4.1-fast):', r.rows.filter((x) => x.has_old_model === 'YES').length)

    await c.end()
}
main().catch(console.error)
