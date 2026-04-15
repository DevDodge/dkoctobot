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

    const id = 'd469f086-7935-4a7e-82f4-f15c6c11d889'

    // Delete related records first
    const msgs = await c.query('DELETE FROM chat_message WHERE chatflowid = $1', [id])
    console.log('Deleted chat_message rows:', msgs.rowCount)

    const feedback = await c.query('DELETE FROM chat_message_feedback WHERE chatflowid = $1', [id])
    console.log('Deleted chat_message_feedback rows:', feedback.rowCount)

    const upserts = await c.query('DELETE FROM upsert_history WHERE chatflowid = $1', [id])
    console.log('Deleted upsert_history rows:', upserts.rowCount)

    // Delete the chatflow itself
    const cf = await c.query('DELETE FROM chat_flow WHERE id = $1', [id])
    console.log('Deleted chat_flow rows:', cf.rowCount)

    console.log('DONE - Ahmed-Zenoo- Cothes FB has been deleted')
    await c.end()
}
main().catch(console.error)
