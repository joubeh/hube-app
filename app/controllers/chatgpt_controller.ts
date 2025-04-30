import type { HttpContext } from '@adonisjs/core/http'
import openai from '#services/openai_service'
import ChatgptConversation from '#models/chatgpt_conversation'
import ChatgptMessage from '#models/chatgpt_message'
import { randomUUID } from 'crypto'
import ChatgptImage from '#models/chatgpt_image'
import { uploadFromUrl } from '#services/storage_service'

type Pricing = {
  [quality: string]: {
    [size: string]: number
  }
}

type ImageGenerationModel = {
  model: string
  name: string
  description: string
  qualities: string[]
  sizes: string[]
  pricing: Pricing
}
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
  private imageGenerationModels: ImageGenerationModel[] = [
    // {
    //   model: 'gpt-image-1',
    //   name: 'GPT Image 1',
    //   description: 'جدیدترین مدل تولید عکس',
    //   qualities: ['low', 'medium', 'high'],
    //   sizes: ['1024x1024', '1024x1536', '1536x1024'],
    //   pricing: {
    //     low: {
    //       '1024x1024': 0.011,
    //       '1024x1536': 0.016,
    //       '1536x1024': 0.016,
    //     },
    //     medium: {
    //       '1024x1024': 0.042,
    //       '1024x1536': 0.063,
    //       '1536x1024': 0.063,
    //     },
    //     high: {
    //       '1024x1024': 0.167,
    //       '1024x1536': 0.25,
    //       '1536x1024': 0.25,
    //     },
    //   },
    // },
    {
      model: 'dall-e-3',
      name: 'DALL·E 3',
      description: 'جدیدترین مدل تولید عکس',
      // description: 'مدل قبلی تولید عکس',
      qualities: ['standard', 'hd'],
      sizes: ['1024x1024', '1024x1792', '1792x1024'],
      pricing: {
        standard: {
          '1024x1024': 0.04,
          '1024x1792': 0.08,
          '1792x1024': 0.08,
        },
        hd: {
          '1024x1024': 0.08,
          '1024x1792': 0.12,
          '1792x1024': 0.12,
        },
      },
    },
    {
      model: 'dall-e-2',
      name: 'DALL·E 2',
      description: 'مدل قبلی تولید عکس',
      // description: 'قدیمی ترین مدل تولید عکس',
      qualities: ['standard'],
      sizes: ['256x256', '512x512', '1024x1024'],
      pricing: {
        standard: {
          '256x256': 0.016,
          '512x512': 0.018,
          '1024x1024': 0.02,
        },
      },
    },
  ]

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

  // todo: return search sources and reasoning thinking
  private async ask(
    context: HttpContext,
    prompt: string,
    model: string,
    conversation: ChatgptConversation,
    useWebSearch: boolean = false,
    useReasoning: boolean = false,
    reasoningEffort: 'low' | 'medium' | 'high' | null = null
  ) {
    const { response } = context

    const messages = await ChatgptMessage.query()
      .select(['response_id'])
      .where('conversation_id', conversation.id)
      .where('role', 'assistant')
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
      const stream = await openai.responses.create({
        model: model,
        input: prompt,
        stream: true,
        previous_response_id: previousResponseId,
        ...(useWebSearch && { tools: [{ type: 'web_search_preview' }] }),
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
          await ChatgptMessage.createMany([
            {
              conversationId: conversation.id,
              model: model,
              role: 'user',
              content: prompt,
              tokensCount: chunk.response.usage ? chunk.response.usage.input_tokens : 0,
              responseId: null,
              useWebSearch: useWebSearch,
              useReasoning: useReasoning,
              reasoningEffort: reasoningEffort,
            },
            {
              conversationId: conversation.id,
              model: model,
              role: 'assistant',
              content: modelResponse,
              tokensCount: chunk.response.usage ? chunk.response.usage.output_tokens : 0,
              responseId: newResponseId,
              useWebSearch: useWebSearch,
              useReasoning: useReasoning,
              reasoningEffort: reasoningEffort,
            },
          ])
        }
      }

      if (messages.length === 0) {
        conversation.title = prompt.split(' ').slice(0, 5).join(' ')
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
      reasoningEffort
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

  // async updateMessage(context: HttpContext) {
  //   const { request, response, auth, params } = context
  //   const user = await auth.authenticateUsing(['api'])

  //   const { prompt, model } = request.all()
  //   if (!prompt || !model) {
  //     return response.unprocessableEntity()
  //   }

  //   const messageId = params.id
  //   const message = await ChatgptMessage.find(messageId)
  //   if (!message) return response.notFound()
  //   if (message.role !== 'user') return response.badRequest()
  //   const conversation = await ChatgptConversation.find(message.conversationId)
  //   if (!conversation) return response.notFound()
  //   if (conversation.userId !== user.id) return response.forbidden()

  //   const createdAt = message.createdAt.toSQL()!
  //   await ChatgptMessage.query()
  //     .where('conversation_id', conversation.id)
  //     .where('created_at', '>=', createdAt)
  //     .delete()

  //   return await this.ask(context, prompt, model, conversation)
  // }

  async generateImage(context: HttpContext) {
    const { request, response, auth } = context
    const user = await auth.authenticateUsing(['api'])

    const { prompt, model, size, quality } = request.all()
    if (!prompt || !model) {
      return response.unprocessableEntity()
    }
    const imageGenerationModel = this.imageGenerationModels.find((m) => m.model === model)
    if (!imageGenerationModel) {
      return response.unprocessableEntity({ error: 'مدل انتخابی اشتباه است' })
    }
    if (!imageGenerationModel.sizes.includes(size)) {
      return response.unprocessableEntity({ error: 'این مدل از این سایز پشتیبانی نمی کند' })
    }
    if (!imageGenerationModel.qualities.includes(quality)) {
      return response.unprocessableEntity({ error: 'این مدل از این کیفیت پشتیبانی نمی کند' })
    }

    const chatgptImage = await ChatgptImage.create({
      userId: user.id,
      model: model,
      prompt: prompt,
      size: size,
      quality: quality,
      isDone: false,
      error: false,
    })

    openai.images
      .generate({
        model: model,
        prompt,
        quality: quality,
        size: size,
      })
      .then(async (value) => {
        if (value.data?.length && value.data[0].url) {
          await uploadFromUrl(
            value.data[0].url,
            'chatgpt-generated-images',
            `${user.id}-${randomUUID()}.png`
          )

          chatgptImage.output = value.data[0].url
          chatgptImage.isDone = true
          await chatgptImage.save()
        } else {
          throw new Error('خطایی پیش آمده دوباره تلاش کنید')
        }
      })
      .catch(async (e) => {
        chatgptImage.output = e?.message ?? ''
        chatgptImage.error = true
        chatgptImage.isDone = true
        await chatgptImage.save()
      })

    return {
      image: chatgptImage,
    }
  }

  async image(context: HttpContext) {
    const { response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const image = await ChatgptImage.find(params.id)
    if (!image) {
      return response.notFound()
    }
    if (image.userId !== user.id) {
      return response.forbidden()
    }

    return {
      image: image,
    }
  }
}
