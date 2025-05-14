import { Job } from '@rlanz/bull-queue'
import openai from '#services/openai_service'
import { cuid } from '@adonisjs/core/helpers'
import app from '@adonisjs/core/services/app'
import path from 'path'
import ChatgptMessage from '#models/chatgpt_message'
import env from '#start/env'
import { toFile } from 'openai'
import * as promiseFs from 'fs/promises'
import { Readable } from 'stream'

interface GenerateChatgptImageJobPayload {
  prompt: string
  model: 'gpt-image-1'
  quality: 'low' | 'medium' | 'high'
  size: '1024x1024' | '1024x1536' | '1536x1024'
  messageId: number
  userId: number
  mode: 'generate' | 'edit'
  inputImages: string[]
}

export default class GenerateChatgptImageJob extends Job {
  // This is the path to the file that is used to create the job
  static get $$filepath() {
    return import.meta.url
  }

  /**
   * Base Entry point
   */
  async handle(payload: GenerateChatgptImageJobPayload) {
    const imageRow = await ChatgptMessage.find(payload.messageId)
    if (!imageRow) {
      throw new Error('message was not found')
    }

    let value
    if (payload.mode === 'generate') {
      value = await openai.images.generate({
        model: payload.model,
        prompt: payload.prompt,
        quality: payload.quality,
        size: payload.size,
      })
    } else {
      const images = await Promise.all(
        payload.inputImages.map(async (src) => {
          const res = await fetch(src)
          if (res.ok || !res.body) {
            throw new Error(`Failed to fetch ${src}: ${res.status} ${res.statusText}`)
          }
          const filename = path.basename(new URL(src).pathname) || 'image'
          return toFile(Readable.fromWeb(res.body), filename)
        })
      )

      value = await openai.images.edit({
        model: payload.model,
        prompt: payload.prompt,
        quality: payload.quality,
        size: payload.size,
        image: images,
      })
    }

    if (value.data?.length && value.data[0].b64_json) {
      const dirAddr = `chatgpt/generated-images/${payload.userId}`
      const saveDir = app.publicPath(dirAddr)
      await promiseFs.mkdir(saveDir, { recursive: true })

      const name = `${cuid()}.png`
      const filePath = path.join(saveDir, name)

      const imageBuffer = Buffer.from(value.data[0].b64_json, 'base64')
      await promiseFs.writeFile(filePath, imageBuffer)

      const dl = `${env.get('APP_URL')}/${dirAddr}/${name}`

      imageRow.content = dl
      imageRow.isDone = true
      await imageRow.save()
    } else {
      throw new Error('image is not available')
    }
  }

  /**
   * This is an optional method that gets called when the retries has exceeded and is marked failed.
   */
  async rescue(payload: GenerateChatgptImageJobPayload) {
    await ChatgptMessage.query()
      .whereIn('id', [payload.messageId - 1, payload.messageId])
      .delete()
  }
}
