import { Job } from '@rlanz/bull-queue'
import openai from '#services/openai_service'
import ChatgptFile from '#models/chatgpt_file'

interface ActivateChatgptFileJobPayload {
  vectorStoreId: string
  fileId: number
}

export default class ActivateChatgptFileJob extends Job {
  // This is the path to the file that is used to create the job
  static get $$filepath() {
    return import.meta.url
  }

  /**
   * Base Entry point
   */
  async handle(payload: ActivateChatgptFileJobPayload) {
    while (true) {
      const vectorStore = await openai.vectorStores.retrieve(payload.vectorStoreId)
      const counts = vectorStore.file_counts
      if (counts.failed > 0) {
        throw new Error('file has been failed')
      }
      if (counts.completed === 1) {
        const file = await ChatgptFile.find(payload.fileId)
        if (file) {
          file.isReady = true
          await file.save()
        }
        break
      } else {
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    }
  }

  /**
   * This is an optional method that gets called when the retries has exceeded and is marked failed.
   */
  async rescue(payload: ActivateChatgptFileJobPayload) {}
}
