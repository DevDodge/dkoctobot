import { OutputModeration, OutputCheckResult } from '../Moderation'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'

const SUPERVISOR_PROMPT = `You are a CONSERVATIVE Output Supervisor for a sales chatbot. You review responses for CLEAR, SERIOUS rule violations only.

IMPORTANT — YOUR LIMITATIONS:
- You do NOT have access to the agent's system prompt or image library.
- You CANNOT verify if image URLs are official or hallucinated. NEVER flag image URLs.
- You CANNOT verify exact template wording. If text looks like a product offer, APPROVE it.
- You CAN ONLY check: language style, forbidden phrases, data repetition, price accuracy, product logic, flow compliance.

CRITICAL INSTRUCTIONS:
- ONLY flag DEFINITE, CLEAR violations. If unsure, APPROVE.
- Product offer blocks (with prices, features, emojis, ✔️ bullet points) are PRE-APPROVED templates. NEVER flag them.
- When checking for forbidden words, ONLY check conversational sentences — NOT offer templates.
- Egyptian Arabic slang (NEVER flag): يا فندم, حضرتك, أهلاً بحضرتك, بتسأل, إيه, بالظبط, أيوة, تمام, ماشي, دلوقتي, ده, متبقي.
- "مستر" prefix is ONLY required when using the customer's actual name. No name = no violation.
- Scarcity/urgency language IS CORRECT for Smart Key. Do not flag it.

VALIDATION RULES:
{rules}

USER INPUT:
{input}

AGENT RESPONSE:
{output}

Respond ONLY with valid JSON (no markdown, no code fences).
IMPORTANT: Write "violations" and "feedback" values in Arabic (Egyptian dialect). Example:
{"approved":false,"violations":["استخدم كلمة فصحى ممنوعة: كالتالي"],"feedback":"استبدل كلمة كالتالي بكلمة عامية زي: دي الأسعار","confidence":0.9}

Format: {"approved":true/false,"violations":["سبب المخالفة بالعربي"],"feedback":"التصحيح المطلوب بالعربي","confidence":0.0-1.0}

When in doubt, APPROVE. Only reject for violations that would genuinely harm the business or confuse the customer.`

export class OutputSupervisorRunner implements OutputModeration {
    private readonly validationRules: string
    private readonly model: BaseChatModel

    constructor(validationRules: string, model: BaseChatModel) {
        this.validationRules = validationRules
        this.model = model
    }

    async checkOutput(output: string, input: string): Promise<OutputCheckResult> {
        try {
            const prompt = SUPERVISOR_PROMPT.replace('{rules}', this.validationRules).replace('{input}', input).replace('{output}', output)

            const res = await this.model.invoke(prompt)
            const content = res.content.toString().trim()

            // Try to parse JSON from the response, handling potential markdown fences
            let jsonStr = content
            const jsonMatch = content.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                jsonStr = jsonMatch[0]
            }

            const parsed = JSON.parse(jsonStr)

            return {
                approved: Boolean(parsed.approved),
                violations: Array.isArray(parsed.violations) ? parsed.violations : [],
                feedback: parsed.feedback || '',
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
            }
        } catch (error) {
            // If supervisor fails to parse/run, approve by default to not block the response
            console.error('Output Supervisor error:', error)
            return {
                approved: true,
                violations: [],
                feedback: 'Supervisor encountered an error, response approved by default.',
                confidence: 0.0
            }
        }
    }
}
