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
    const r = await c.query(
        'SELECT cf.id, cf.name, COUNT(cm.id) as msg_count FROM chat_flow cf LEFT JOIN chat_message cm ON cm.chatflowid = cf.id AND cm."createdDate" > NOW() - INTERVAL \'1 hour\' GROUP BY cf.id, cf.name HAVING COUNT(cm.id) > 0 ORDER BY msg_count DESC LIMIT 15'
    )
    console.log('=== CHATFLOWS WITH MESSAGES IN LAST HOUR ===')
    r.rows.forEach((row) => console.log(row.msg_count + ' msgs | ' + row.name + ' | ' + row.id))
    await c.end()
}
main().catch(console.error)
