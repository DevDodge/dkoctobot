import { IServerSideEventStreamer } from '../../src'

export abstract class Moderation {
    abstract checkForViolations(input: string): Promise<string>
}

export interface OutputCheckResult {
    approved: boolean
    violations: string[]
    feedback: string
    correctedOutput?: string
    confidence: number
}

export abstract class OutputModeration {
    abstract checkOutput(output: string, input: string): Promise<OutputCheckResult>
}

export const checkInputs = async (inputModerations: Moderation[], input: string): Promise<string> => {
    for (const moderation of inputModerations) {
        input = await moderation.checkForViolations(input)
    }
    return input
}

export const checkOutputs = async (outputModerations: OutputModeration[], output: string, input: string): Promise<OutputCheckResult> => {
    for (const moderation of outputModerations) {
        const result = await moderation.checkOutput(output, input)
        if (!result.approved) {
            return result
        }
    }
    return { approved: true, violations: [], feedback: '', confidence: 1.0 }
}

// is this the correct location for this function?
// should we have a utils files that all node components can use?
export const streamResponse = (sseStreamer: IServerSideEventStreamer, chatId: string, response: string) => {
    const result = response.split(/(\s+)/)
    result.forEach((token: string, index: number) => {
        if (index === 0) {
            sseStreamer.streamStartEvent(chatId, token)
        }
        sseStreamer.streamTokenEvent(chatId, token)
    })
    sseStreamer.streamEndEvent(chatId)
}
