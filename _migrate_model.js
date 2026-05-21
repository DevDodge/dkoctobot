/**
 * ==========================================================
 *  DK-Platform - Model Migration Script
 * ==========================================================
 *  Purpose: Replace "x-ai/grok-4.3" with "google/gemini-2.5-flash"
 *           across ALL chatflows in the Flowise database.
 *
 *  Steps:
 *    1. Backup all chat_flow records to a JSON file
 *    2. Identify affected chatflows
 *    3. Replace the model name in flowData
 *    4. Update the database
 *    5. Verify the changes
 * ==========================================================
 */

const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

// ============= CONFIG =============
const DB_CONFIG = {
    host: 'localhost',
    port: 10034,
    user: 'postgres',
    password: 'Eng.OctoBot-DK-Kareem-DODGE.12',
    database: 'dk_octobot'
}

const OLD_MODEL = 'x-ai/grok-4.3'
const NEW_MODEL = 'google/gemini-2.5-flash'
const BACKUP_DIR = path.join(__dirname, '_backups')

// ============= HELPERS =============
function getTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-')
}

function log(msg) {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

// ============= MAIN =============
async function main() {
    const client = new Client(DB_CONFIG)

    try {
        await client.connect()
        log('✅ Connected to database: ' + DB_CONFIG.database)

        // ---- STEP 1: Full Backup ----
        log('')
        log('='.repeat(60))
        log('📦 STEP 1: Creating full backup of all chat_flow records...')
        log('='.repeat(60))

        // Create backup directory
        if (!fs.existsSync(BACKUP_DIR)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true })
        }

        const allFlows = await client.query('SELECT * FROM chat_flow')
        const backupFile = path.join(BACKUP_DIR, `chat_flow_backup_${getTimestamp()}.json`)

        const backupData = {
            metadata: {
                backupDate: new Date().toISOString(),
                database: DB_CONFIG.database,
                totalRecords: allFlows.rows.length,
                reason: `Migration: ${OLD_MODEL} -> ${NEW_MODEL}`
            },
            records: allFlows.rows
        }

        fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8')
        log(`✅ Backup saved: ${backupFile}`)
        log(`   Total records backed up: ${allFlows.rows.length}`)

        // ---- STEP 2: Identify affected chatflows ----
        log('')
        log('='.repeat(60))
        log('🔍 STEP 2: Identifying affected chatflows...')
        log('='.repeat(60))

        const affected = await client.query(`SELECT id, name, "flowData" FROM chat_flow WHERE "flowData"::text LIKE $1`, [`%${OLD_MODEL}%`])

        log(`Found ${affected.rows.length} chatflows containing "${OLD_MODEL}"`)
        log('')

        if (affected.rows.length === 0) {
            log('⚠️  No chatflows found with the old model. Nothing to migrate.')
            await client.end()
            return
        }

        // List affected chatflows
        affected.rows.forEach((row, i) => {
            log(`  ${String(i + 1).padStart(2)}. ${row.name} (${row.id})`)
        })

        // ---- STEP 3: Replace model in flowData ----
        log('')
        log('='.repeat(60))
        log(`🔄 STEP 3: Replacing "${OLD_MODEL}" -> "${NEW_MODEL}"...`)
        log('='.repeat(60))

        let successCount = 0
        let failCount = 0

        for (const row of affected.rows) {
            try {
                // flowData is stored as text/JSON string
                let flowData = row.flowData

                // Count occurrences before replacement
                const occurrences = (flowData.match(new RegExp(OLD_MODEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length

                // Replace all occurrences
                const updatedFlowData = flowData.split(OLD_MODEL).join(NEW_MODEL)

                // Update in database
                await client.query(`UPDATE chat_flow SET "flowData" = $1 WHERE id = $2`, [updatedFlowData, row.id])

                successCount++
                log(`  ✅ ${row.name} — ${occurrences} occurrence(s) replaced`)
            } catch (err) {
                failCount++
                log(`  ❌ ${row.name} — ERROR: ${err.message}`)
            }
        }

        // ---- STEP 4: Verify ----
        log('')
        log('='.repeat(60))
        log('🔍 STEP 4: Verifying migration...')
        log('='.repeat(60))

        const remaining = await client.query(`SELECT id, name FROM chat_flow WHERE "flowData"::text LIKE $1`, [`%${OLD_MODEL}%`])

        const newModelCount = await client.query(`SELECT id, name FROM chat_flow WHERE "flowData"::text LIKE $1`, [`%${NEW_MODEL}%`])

        log(`  Chatflows still using "${OLD_MODEL}": ${remaining.rows.length}`)
        log(`  Chatflows now using "${NEW_MODEL}": ${newModelCount.rows.length}`)

        if (remaining.rows.length > 0) {
            log('')
            log('⚠️  WARNING: Some chatflows still have the old model:')
            remaining.rows.forEach((row) => log(`    - ${row.name} (${row.id})`))
        }

        // ---- SUMMARY ----
        log('')
        log('='.repeat(60))
        log('📊 MIGRATION SUMMARY')
        log('='.repeat(60))
        log(`  Old Model:       ${OLD_MODEL}`)
        log(`  New Model:       ${NEW_MODEL}`)
        log(`  Total Affected:  ${affected.rows.length}`)
        log(`  Successful:      ${successCount}`)
        log(`  Failed:          ${failCount}`)
        log(`  Backup File:     ${backupFile}`)
        log('')

        if (failCount === 0 && remaining.rows.length === 0) {
            log('🎉 Migration completed successfully!')
        } else {
            log('⚠️  Migration completed with issues. Please review above.')
        }
    } catch (err) {
        console.error('❌ Fatal error:', err)
    } finally {
        await client.end()
        log('🔌 Database connection closed.')
    }
}

main()
