import type { HttpContext } from '@adonisjs/core/http'
import openai from '#services/openai_service'
import ChatgptConversation from '#models/chatgpt_conversation'
import ChatgptMessage from '#models/chatgpt_message'
import app from '@adonisjs/core/services/app'
import fs from 'node:fs/promises'
import * as theRealFS from 'fs'
import env from '#start/env'
import { cuid } from '@adonisjs/core/helpers'
import { ChatgptfileUpload } from '#validators/upload'
import { DateTime } from 'luxon'
import ChatgptFile from '#models/chatgpt_file'
import { OpenAI } from 'openai'
import queue from '@rlanz/bull-queue/services/main'
import ActivateChatgptFileJob from '../jobs/activate_chatgpt_file_job.js'
import GenerateChatgptImageJob from '../jobs/generate_chatgpt_image_job.js'

export default class ChatgptController {
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

  async shareConversation(context: HttpContext) {
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const conversationId = params.id
    const conversation = await ChatgptConversation.findOrFail(conversationId)
    if (conversation.isHidden) return response.notFound()
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
    const conversation = await ChatgptConversation.findOrFail(conversationId)
    if (!conversation.isHidden) return response.notFound()
    if (conversation.userId !== user.id) return response.forbidden()

    conversation.isHidden = true
    await conversation.save()

    return {
      ok: true,
    }
  }

  async uploadFile(context: HttpContext) {
    const HOURS_UNTIL_EXPIRE = 12
    const { request, response, auth } = context
    const user = await auth.authenticateUsing(['api'])

    const payload = await request.validateUsing(ChatgptfileUpload)
    const file = payload.file
    const image = payload.image

    if (file) {
      if (!file.tmpPath) {
        return response.internalServerError({
          message: 'فایل آپلود نشد.',
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

        const expiresAt = DateTime.now().plus({ hours: HOURS_UNTIL_EXPIRE })
        const chatgptFile = await ChatgptFile.create({
          userId: user.id,
          messageId: null,
          url: `${env.get('APP_URL')}/${dirAddr}/${name}`,
          size: file.size,
          type: 'file',
          expiresAt: expiresAt,
          vectorStore: vectorStore.id,
          isReady: false,
          isExpired: false,
        })

        queue.dispatch(ActivateChatgptFileJob, {
          vectorStoreId: vectorStore.id,
          fileId: chatgptFile.id,
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
          isReady: true,
          isExpired: false,
        })
        return { file: chatgptFile }
      } catch (e) {
        return response.internalServerError({ error: e?.message || 'خطایی پیش آمده' })
      }
    }

    return response.unprocessableEntity({ error: 'هیچ فایلی آپلود نشد' })
  }

  async fileStatus(context: HttpContext) {
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])
    const id = params.id
    const file = await ChatgptFile.findOrFail(id)
    if (file.userId !== user.id) return response.forbidden()
    return { isReady: file.isReady }
  }

  async conversation(context: HttpContext) {
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const conversationId = params.id
    const conversation = await ChatgptConversation.findOrFail(conversationId)

    if (conversation.isHidden) return response.notFound({ error: 'گفتگو وجود ندارد' })
    if (!conversation.isPublic && conversation.userId !== user.id)
      return response.forbidden({ error: 'شما به این گفتگو دسترسی ندارید' })

    const messages = await ChatgptMessage.query()
      .where('conversation_id', conversationId)
      .preload('files')
      .orderBy('created_at', 'asc')

    return {
      conversation: conversation,
      messages: messages,
      isOwner: conversation.userId === user.id,
    }
  }

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

  private async ask(
    context: HttpContext,
    prompt: string,
    model: string,
    conversation: ChatgptConversation,
    useWebSearch: boolean = false,
    useReasoning: boolean = false,
    reasoningEffort: 'low' | 'medium' | 'high' | null = null,
    filesId: number[],
    parent: ChatgptMessage | null
  ) {
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

      const stream = await openai.responses.create({
        model: model,
        input: input,
        stream: true,
        previous_response_id: parent ? parent.responseId : null,
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
            parentId: parent ? parent.id : null,
          })

          if (filesId.length > 0) {
            await ChatgptFile.query().whereIn('id', filesId).update({ messageId: userMessage.id })
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
            parentId: parent ? parent.id : null,
          })
        }
      }

      response.response.end()
    } catch (e) {
      console.log(e)
      response.response.write('خطایی پیش آمده.')
      response.response.end()
    }
  }

  async messageConversation(context: HttpContext) {
    const { request, response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const conversationId = params.id
    const {
      prompt,
      model,
      parentId = null,
      useWebSearch = false,
      useReasoning = false,
      reasoningEffort = null,
      filesId = [],
    } = request.all()
    if (!prompt || !model) {
      return response.unprocessableEntity()
    }

    const conversation = await ChatgptConversation.findOrFail(conversationId)
    if (conversation.userId !== user.id) return response.forbidden()

    if (!parentId) {
      conversation.title = `${prompt.split(' ').slice(0, 7).join(' ')}...`
      await conversation.save()
    }
    const parent = parentId ? await ChatgptMessage.find(parentId) : null

    return await this.ask(
      context,
      prompt,
      model,
      conversation,
      useWebSearch,
      useReasoning,
      reasoningEffort,
      filesId,
      parent
    )
  }

  async updateMessage(context: HttpContext) {
    const { request, response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const messageId = params.id
    const oldMessage = await ChatgptMessage.findOrFail(messageId)
    const conversation = await ChatgptConversation.findOrFail(oldMessage.conversationId)
    if (conversation.userId !== user.id) return response.forbidden()

    if (oldMessage.role === 'user') {
      const { prompt } = request.all()
      if (!prompt) {
        return response.unprocessableEntity()
      }

      const files = await ChatgptFile.query().where('message_id', oldMessage.id).exec()
      const parent = oldMessage.parentId ? await ChatgptMessage.find(oldMessage.parentId) : null

      return await this.ask(
        context,
        prompt,
        oldMessage.model,
        conversation,
        oldMessage.useWebSearch,
        oldMessage.useReasoning,
        oldMessage.reasoningEffort as 'low' | 'medium' | 'high' | null,
        files.map((f) => f.id),
        parent
      )
    }

    const parent = await ChatgptMessage.find(oldMessage.parentId)
    return await this.ask(
      context,
      oldMessage.content,
      oldMessage.model,
      conversation,
      oldMessage.useWebSearch,
      oldMessage.useReasoning,
      oldMessage.reasoningEffort as 'low' | 'medium' | 'high' | null,
      [],
      parent
    )
  }

  async generateImage(context: HttpContext) {
    const qualities = ['low', 'medium', 'high']
    const sizes = ['1024x1024', '1024x1536', '1536x1024']
    const model = 'gpt-image-1'

    const { request, response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const { prompt, size, quality, parentId = null, filesId = [] } = request.all()
    if (!prompt) {
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

    const imagesId: number[] = []
    const images: string[] = []
    if (filesId.length > 0) {
      const user = await context.auth.authenticateUsing(['api'])
      const chatgptFiles = await ChatgptFile.findMany(filesId)
      chatgptFiles.forEach((f) => {
        if (f.userId === user.id) {
          if (f.type === 'image') {
            images.push(f.url)
            imagesId.push(f.id)
          }
        }
      })
    }

    const requestMessage = await ChatgptMessage.create({
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
      parentId: parentId ? parentId : null,
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
      parentId: requestMessage.id,
    })

    await queue.dispatch(GenerateChatgptImageJob, {
      model: model,
      prompt: prompt,
      quality: quality,
      size: size,
      messageId: imageRow.id,
      userId: user.id,
      mode: images.length > 0 ? 'edit' : 'generate',
      inputImages: images,
    })

    if (images.length > 0) {
      await ChatgptFile.query().whereIn('id', imagesId).update({ messageId: requestMessage.id })
    }

    if (!parentId) {
      conversation.title = `${prompt.split(' ').slice(0, 7).join(' ')}...`
      await conversation.save()
    }

    return {
      id: imageRow.id,
    }
  }

  async message(context: HttpContext) {
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const messageId = params.id
    const message = await ChatgptMessage.findOrFail(messageId)
    const conversation = await ChatgptConversation.findOrFail(message.conversationId)
    if (conversation.userId !== user.id) {
      return response.forbidden()
    }

    return { message: message }
  }

  async messageTTS(context: HttpContext) {}

  async transcribe(context: HttpContext) {}

  async generateImageSora(context: HttpContext) {
    const qualities = ['low', 'medium', 'high']
    const sizes = ['1024x1024', '1024x1536', '1536x1024']
    const model = 'gpt-image-1'

    const { request, response, auth } = context
    const user = await auth.authenticateUsing(['api'])

    const { prompt, size, quality, filesId = [] } = request.all()
    if (!prompt) {
      return response.unprocessableEntity()
    }
    if (!sizes.includes(size)) {
      return response.unprocessableEntity({ error: 'این سایز پشتیبانی نمی شود' })
    }
    if (!qualities.includes(quality)) {
      return response.unprocessableEntity({ error: 'این کیفیت پشتیبانی نمی شود' })
    }

    const conversation = await ChatgptConversation.create({
      userId: user.id,
      title: 'Image Conversation',
      isHidden: true,
      isPublic: false,
    })

    const imagesId: number[] = []
    const images: string[] = []
    if (filesId.length > 0) {
      const user = await context.auth.authenticateUsing(['api'])
      const chatgptFiles = await ChatgptFile.findMany(filesId)
      chatgptFiles.forEach((f) => {
        if (f.userId === user.id) {
          if (f.type === 'image') {
            images.push(f.url)
            imagesId.push(f.id)
          }
        }
      })
    }

    const requestMessage = await ChatgptMessage.create({
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
      parentId: null,
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
      parentId: requestMessage.id,
    })

    await queue.dispatch(GenerateChatgptImageJob, {
      model: model,
      prompt: prompt,
      quality: quality,
      size: size,
      messageId: imageRow.id,
      userId: user.id,
      mode: images.length > 0 ? 'edit' : 'generate',
      inputImages: images,
    })

    if (images.length > 0) {
      await ChatgptFile.query().whereIn('id', imagesId).update({ messageId: requestMessage.id })
    }

    return {
      id: imageRow.id,
    }
  }
}
