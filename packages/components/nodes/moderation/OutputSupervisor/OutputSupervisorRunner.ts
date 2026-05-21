import { OutputModeration, OutputCheckResult } from '../Moderation'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'

const SUPERVISOR_PROMPT = `You are a STRICT but CONSERVATIVE Output Supervisor. You review agent responses for CLEAR rule violations ONLY.

## YOUR ABSOLUTE RULES:

### 1. FORBIDDEN WORDS — STRICT MATCHING ONLY
- You may ONLY flag a word as "forbidden Fusha" if it appears EXACTLY in the forbidden words list provided in the rules below.
- Words like السعر، الخصم، رسوم، تركيب، مفتاح، خدمة، سرعة، حجز، موديل، باقة، عرض are NORMAL Arabic words, NOT Fusha. NEVER flag them.
- If a word is NOT explicitly listed as forbidden in the rules, it is ALLOWED. Do not guess or assume.

### 2. CONTEXT PRESERVATION — NEVER CHANGE THE PRODUCT
- If the agent is discussing "مفتاح" (key), the correction MUST stay about "مفتاح". NEVER replace it with "طارة" (steering wheel) or any other product.
- If the agent is discussing "شاشة" (screen), the correction MUST stay about "شاشة".
- Changing the product/context is WORSE than the original violation. APPROVE instead of making a wrong correction.

### 3. APPROVAL BIAS
- When in doubt, APPROVE. A false rejection is worse than missing a minor violation.
- ONLY reject for violations that would genuinely confuse the customer or harm the business.
- Product offer templates (with emojis, bullet points, prices, features) are PRE-APPROVED. NEVER flag them.

### 4. YOUR LIMITATIONS
- You do NOT have access to the agent's system prompt.
- You CANNOT verify image URLs. NEVER flag them.
- You CANNOT verify exact template wording.

VALIDATION RULES:
{rules}

USER INPUT:
{input}

AGENT RESPONSE:
{output}

Respond ONLY with valid JSON (no markdown, no code fences).
IMPORTANT: Write "violations" and "feedback" in Arabic (Egyptian dialect).
Format: {"approved":true/false,"violations":["سبب المخالفة بالعربي"],"feedback":"التصحيح المطلوب بالعربي — بدون تغيير سياق المنتج","confidence":0.0-1.0}

REMEMBER: Only flag words that are EXPLICITLY in the forbidden list. Common Arabic words are NOT Fusha.`

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
