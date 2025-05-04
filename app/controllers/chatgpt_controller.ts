import type { HttpContext } from '@adonisjs/core/http'
import openai from '#services/openai_service'
import ChatgptConversation from '#models/chatgpt_conversation'
import ChatgptMessage from '#models/chatgpt_message'
import app from '@adonisjs/core/services/app'
import path from 'node:path'
import fs from 'node:fs/promises'
import * as theRealFS from 'fs'
import env from '#start/env'
import { cuid } from '@adonisjs/core/helpers'
import { fileUpload } from '#validators/upload'
import { DateTime } from 'luxon'
import ChatgptFile from '#models/chatgpt_file'
import { OpenAI } from 'openai'

/*
type TextModel = {
  model: string
  name: string
  description: string
  canReasoning: boolean
  canWebSearch: boolean
  canFileSearch: boolean
  input_price_per_million_tokens: number
  output_price_per_million_tokens: number
}
  */
export default class ChatgptController {
  /*
  private textModels: TextModel[] = [
    {
      model: 'gpt-4o',
      name: 'ChatGPT 4o',
      description: 'برای اکثر سوالات عالی است',
      canReasoning: false,
      canWebSearch: true,
      canFileSearch: false,
      input_price_per_million_tokens: 2.5,
      output_price_per_million_tokens: 10,
    },
    // {
    //   model: 'o3',
    //   name: 'ChatGPT o3',
    //   description: 'قوی ترین در استدلال پیشرفته',
    //   canReasoning: true,
    //   canWebSearch: false,
    //   canFileSearch: false,
    //   canGenerateImage: false,
    //   input_price_per_million_tokens: 10,
    //   output_price_per_million_tokens: 40,
    // },
    {
      model: 'o4-mini',
      name: 'ChatGPT o4 mini',
      description: 'سریع‌ترین در استدلال پیشرفته',
      canReasoning: true,
      canWebSearch: false,
      canFileSearch: false,
      input_price_per_million_tokens: 1.1,
      output_price_per_million_tokens: 4.4,
    },
    {
      model: 'gpt-4o-mini',
      name: 'ChatGPT 4o mini',
      description: 'عالی برای کارهای روزمره',
      canReasoning: false,
      canWebSearch: true,
      canFileSearch: false,
      input_price_per_million_tokens: 0.15,
      output_price_per_million_tokens: 0.6,
    },
  ]
  */

  private async pollVectorStoreFileProcessing(vectorStoreId: string, fileIds: string) {
    console.log(`Polling for file processing in Vector Store ${vectorStoreId}...`)
    let allFilesProcessed = false
    const targetFileCount = fileIds.length

    while (!allFilesProcessed) {
      try {
        const vectorStore = await openai.vectorStores.retrieve(vectorStoreId)
        const counts = vectorStore.file_counts

        if (counts.failed > 0) {
          throw new Error(`File processing failed for vector store ${vectorStoreId}`)
        }

        if (counts.completed === targetFileCount) {
          console.log('All files processed successfully.')
          allFilesProcessed = true
        } else {
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      } catch (error) {
        throw error
      }
    }
  }

  // todo: return search sources and reasoning thinking
  private async ask(
    context: HttpContext,
    prompt: string,
    model: string,
    conversation: ChatgptConversation,
    useWebSearch: boolean = false,
    useReasoning: boolean = false,
    reasoningEffort: 'low' | 'medium' | 'high' | null = null,
    filesId: number[]
  ) {
    console.log('ASK')
    const { response } = context

    const files: string[] = []
    const images: string[] = []
    if (filesId.length > 0) {
      const user = await context.auth.authenticateUsing(['api'])
      const chatgptFiles = await ChatgptFile.findMany(filesId)
      chatgptFiles.forEach((f) => {
        if (f.userId === user.id) {
          if (f.type === 'image') {
            images.push(f.url)
          } else if (f.vectorStore) {
            files.push(f.vectorStore)
          }
        }
      })
    }

    const messages = await ChatgptMessage.query()
      .select(['response_id'])
      .where('conversation_id', conversation.id)
      .whereNotNull('response_id')
      .orderBy('id', 'desc')
      .limit(1)
      .exec()
    const previousResponseId = messages.length > 0 ? messages[0].responseId : null

    response.response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
    })

    try {
      const tools: OpenAI.Responses.Tool[] = []
      if (useWebSearch) {
        tools.push({ type: 'web_search_preview' })
      }
      if (files.length > 0) {
        tools.push({ type: 'file_search', vector_store_ids: [...files] })
      }

      let input: string | OpenAI.Responses.ResponseInput = prompt
      if (images.length > 0) {
        const inpImages: OpenAI.Responses.ResponseInputImage[] = images.map((img) => ({
          type: 'input_image',
          image_url: img,
          detail: 'auto',
        }))
        input = [
          {
            role: 'user',
            content: [{ type: 'input_text', text: prompt }, ...inpImages],
          },
        ]
      }

      console.log({
        model: model,
        input: input,
        stream: true,
        previous_response_id: previousResponseId,
        ...(tools.length > 0 && { tools: tools }),
        ...(useReasoning && { reasoning: { effort: reasoningEffort } }),
      })

      const stream = await openai.responses.create({
        model: model,
        input: input,
        stream: true,
        previous_response_id: previousResponseId,
        ...(tools.length > 0 && { tools: tools }),
        ...(useReasoning && { reasoning: { effort: reasoningEffort } }),
      })

      let modelResponse = ''
      let newResponseId = null
      for await (const chunk of stream) {
        if (chunk.type === 'response.output_text.delta') {
          const chunkText = chunk.delta
          if (chunkText) {
            modelResponse += chunkText
            response.response.write(chunkText)
          }
        } else if (chunk.type === 'response.created') {
          newResponseId = chunk.response.id
        } else if (chunk.type === 'response.completed') {
          const userMessage = await ChatgptMessage.create({
            conversationId: conversation.id,
            model: model,
            role: 'user',
            content: prompt,
            tokensCount: chunk.response.usage ? chunk.response.usage.input_tokens : 0,
            responseId: null,
            useWebSearch: useWebSearch,
            useReasoning: useReasoning,
            reasoningEffort: reasoningEffort,
            imageSize: null,
            imageQuality: null,
            isDone: true,
            type: 'text',
          })

          if (filesId.length > 0) {
            await ChatgptFile.query()
              .update({ messageId: userMessage.id })
              .whereIn('id', filesId)
              .exec()
          }

          await ChatgptMessage.create({
            conversationId: conversation.id,
            model: model,
            role: 'assistant',
            content: modelResponse,
            tokensCount: chunk.response.usage ? chunk.response.usage.output_tokens : 0,
            responseId: newResponseId,
            useWebSearch: useWebSearch,
            useReasoning: useReasoning,
            reasoningEffort: reasoningEffort,
            imageSize: null,
            imageQuality: null,
            isDone: true,
            type: 'text',
          })
        }
      }

      if (messages.length === 0) {
        conversation.title = `${prompt.split(' ').slice(0, 5).join(' ')}...`
        await conversation.save()
      }

      response.response.end()
    } catch (e) {
      console.log(e)
      response.response.write('Something went wrong!')
      response.response.end()
    }
  }

  async createConversation(context: HttpContext) {
    const { request, auth } = context
    const user = await auth.authenticateUsing(['api'])

    const { isTemporary = false } = request.all()

    const conversation = await ChatgptConversation.create({
      userId: user.id,
      title: 'New Conversation',
      isHidden: isTemporary,
      isPublic: false,
    })

    return { conversation: conversation }
  }

  async messageConversation(context: HttpContext) {
    const { request, response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const conversationId = params.id
    const {
      prompt,
      model,
      useWebSearch = false,
      useReasoning = false,
      reasoningEffort = null,
      files = [],
    } = request.all()
    if (!prompt || !model) {
      return response.unprocessableEntity()
    }

    const conversation = await ChatgptConversation.find(conversationId)
    if (!conversation) return response.notFound()
    if (conversation.userId !== user.id) return response.forbidden()

    return await this.ask(
      context,
      prompt,
      model,
      conversation,
      useWebSearch,
      useReasoning,
      reasoningEffort,
      files
    )
  }

  async shareConversation(context: HttpContext) {
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const conversationId = params.id
    const conversation = await ChatgptConversation.find(conversationId)

    if (!conversation) return response.notFound()
    if (conversation.isHidden) return response.badRequest()
    if (conversation.userId !== user.id) return response.forbidden()

    conversation.isPublic = true
    await conversation.save()

    return {
      ok: true,
    }
  }

  async deleteConversation(context: HttpContext) {
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const conversationId = params.id
    const conversation = await ChatgptConversation.find(conversationId)

    if (!conversation) return response.notFound()
    if (!conversation.isHidden) return response.badRequest()
    if (conversation.userId !== user.id) return response.forbidden()

    conversation.isHidden = true
    await conversation.save()

    return {
      ok: true,
    }
  }

  async conversation(context: HttpContext) {
    // await new Promise((resolve) => setTimeout(resolve, 10000))
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const conversationId = params.id
    const conversation = await ChatgptConversation.find(conversationId)

    if (!conversation || conversation.isHidden)
      return response.notFound({ error: 'گفتگو وجود ندارد' })
    if (!conversation.isPublic && conversation.userId !== user.id)
      return response.forbidden({ error: 'شما به این گفتگو دسترسی ندارید' })

    const messages = await ChatgptMessage.query()
      .where('conversation_id', conversationId)
      .orderBy('id', 'desc')
      .exec()
    messages.reverse()

    return {
      conversation: conversation,
      messages: messages,
      isOwner: conversation.userId === user.id,
    }
  }

  // TODO: add pagination
  async conversations(context: HttpContext) {
    const { auth, request } = context
    const user = await auth.authenticateUsing(['api'])

    const page = Object.hasOwn(request.qs(), 'page') ? parseInt(request.qs().page) : 1
    const PER_PAGE = 20
    const conversations = await ChatgptConversation.query()
      .where('user_id', user.id)
      .where('is_hidden', false)
      .orderBy('created_at', 'desc')
      .offset((page - 1) * PER_PAGE)
      .limit(PER_PAGE)
      .exec()

    return {
      conversations: conversations,
    }
  }

  async generateImage(context: HttpContext) {
    const qualities = ['standard', 'hd']
    const sizes = ['1024x1024', '1024x1792', '1792x1024']
    // const pricing = {
    //   standard: {
    //     '1024x1024': 0.04,
    //     '1024x1792': 0.08,
    //     '1792x1024': 0.08,
    //   },
    //   hd: {
    //     '1024x1024': 0.08,
    //     '1024x1792': 0.12,
    //     '1792x1024': 0.12,
    //   },
    // }
    const model = 'dall-e-3'

    const { request, response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const { prompt, size, quality } = request.all()
    if (!prompt || !model) {
      return response.unprocessableEntity()
    }
    if (!sizes.includes(size)) {
      return response.unprocessableEntity({ error: 'این سایز پشتیبانی نمی شود' })
    }
    if (!qualities.includes(quality)) {
      return response.unprocessableEntity({ error: 'این کیفیت پشتیبانی نمی شود' })
    }

    const conversation = await ChatgptConversation.find(params.id)
    if (!conversation) return response.notFound()
    if (conversation.userId !== user.id) return response.forbidden()

    await ChatgptMessage.create({
      conversationId: conversation.id,
      model: model,
      role: 'user',
      content: prompt,
      tokensCount: 0,
      responseId: null,
      useWebSearch: false,
      useReasoning: false,
      reasoningEffort: null,
      imageSize: size,
      imageQuality: quality,
      isDone: true,
      type: 'text',
    })
    const imageRow = await ChatgptMessage.create({
      conversationId: conversation.id,
      model: model,
      role: 'assistant',
      content: 'no_content',
      tokensCount: 0,
      responseId: null,
      useWebSearch: false,
      useReasoning: false,
      reasoningEffort: null,
      imageSize: size,
      imageQuality: quality,
      isDone: false,
      type: 'image',
    })

    openai.images
      .generate({
        model: model,
        prompt: prompt,
        quality: quality,
        size: size,
      })
      .then(async (value) => {
        if (value.data?.length && value.data[0].url) {
          const url = value.data[0].url
          const fetchResponse = await fetch(url)
          if (!fetchResponse.ok) {
            throw new Error(`Failed to download image. Status: ${fetchResponse.status}`)
          }

          const dirAddr = `chatgpt/generated-images/${user.id}`
          const saveDir = app.publicPath(dirAddr)
          await fs.mkdir(saveDir, { recursive: true })

          const name = `${cuid()}.png`
          const filePath = path.join(saveDir, name)

          const imageBuffer = Buffer.from(await fetchResponse.arrayBuffer())
          await fs.writeFile(filePath, imageBuffer)

          const dl = `${env.get('APP_URL')}/${dirAddr}/${name}`

          imageRow.content = dl
          imageRow.isDone = true
          await imageRow.save()
        } else {
          throw new Error('خطایی پیش آمده. عکس تولید نشد.')
        }
      })
      .catch(async () => {
        await ChatgptMessage.query()
          .whereIn('id', [imageRow.id - 1, imageRow.id])
          .delete()
      })

    return {
      id: imageRow.id,
    }
  }

  async message(context: HttpContext) {
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const chatgptMessage = await ChatgptMessage.find(params.id)
    if (!chatgptMessage) {
      return {
        status: 404,
        message: null,
      }
    }
    const conversation = await ChatgptConversation.findOrFail(chatgptMessage.conversationId)
    if (conversation.userId !== user.id) {
      return response.forbidden()
    }

    return {
      status: 200,
      message: chatgptMessage,
    }
  }

  async uploadFile(context: HttpContext) {
    await new Promise((resolve) => setTimeout(resolve, 10000))
    const HOURS_UNTIL_EXPIRE = 12
    const { request, response, auth } = context
    const user = await auth.authenticateUsing(['api'])

    const payload = await request.validateUsing(fileUpload)
    const file = payload.file
    const image = payload.image

    if (file) {
      if (!file.tmpPath) {
        return response.internalServerError({
          message: 'File upload failed internally before processing.',
        })
      }

      try {
        const dirAddr = `chatgpt/uploads/${user.id}`
        const saveDir = app.publicPath(dirAddr)
        await fs.mkdir(saveDir, { recursive: true })
        const name = `${cuid()}.${file.extname}`

        await file.move(saveDir, {
          name: name,
          overwrite: false,
        })

        const fileStream = theRealFS.createReadStream(file.tmpPath)
        const result = await openai.files.create({
          file: fileStream,
          purpose: 'user_data',
        })
        const vectorStore = await openai.vectorStores.create({
          name: 'knowledge_base',
          file_ids: [result.id],
        })
        await this.pollVectorStoreFileProcessing(vectorStore.id, result.id)

        const expiresAt = DateTime.now().plus({ hours: HOURS_UNTIL_EXPIRE })
        const chatgptFile = await ChatgptFile.create({
          userId: user.id,
          messageId: null,
          url: `${env.get('APP_URL')}/${dirAddr}/${name}`,
          size: file.size,
          type: 'file',
          expiresAt: expiresAt,
          vectorStore: vectorStore.id,
        })

        return { file: chatgptFile }
      } catch (e) {
        return response.internalServerError({ error: e?.message || 'خطایی پیش آمده' })
      }
    }

    if (image) {
      try {
        const dirAddr = `chatgpt/uploads/${user.id}`
        const saveDir = app.publicPath(dirAddr)
        await fs.mkdir(saveDir, { recursive: true })
        const name = `${cuid()}.${image.extname}`

        await image.move(saveDir, {
          name: name,
          overwrite: false,
        })

        const chatgptFile = await ChatgptFile.create({
          userId: user.id,
          messageId: null,
          url: `${env.get('APP_URL')}/${dirAddr}/${name}`,
          size: image.size,
          type: 'image',
          expiresAt: null,
        })
        return { file: chatgptFile }
      } catch (e) {
        return response.internalServerError({ error: e?.message || 'خطایی پیش آمده' })
      }
    }

    return response.unprocessableEntity({ error: 'هیچ فایلی آپلود نشد' })
  }
}
