import type { HttpContext } from '@adonisjs/core/http'
import openai from '#services/openai_service'
import ChatgptConversation from '#models/chatgpt_conversation'
import ChatgptMessage from '#models/chatgpt_message'
import { encoding_for_model, TiktokenModel } from 'tiktoken'

export default class ChatgptController {
  private getTokenCount(text: string, model: string) {
    const encoding = encoding_for_model(model as TiktokenModel)
    const tokens = encoding.encode(text)
    const tokenCount = tokens.length
    encoding.free()
    return tokenCount
  }

  private async ask(
    context: HttpContext,
    prompt: string,
    model: string,
    conversation: ChatgptConversation
  ) {
    const { response } = context

    const messages = await ChatgptMessage.query()
      .select(['role', 'content'])
      .where('conversation_id', conversation.id)
      .orderBy('id', 'desc')
      // .limit(20)
      .exec()
    messages.reverse()

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
      const stream = await openai.chat.completions.create({
        model: model,
        messages: [
          ...messages,
          {
            role: 'user',
            content: prompt,
          },
        ],
        stream: true,
      })

      let modelResponse = ''
      for await (const chunk of stream) {
        const chunkText = chunk.choices[0]?.delta?.content
        if (chunkText) {
          modelResponse += chunkText
          response.response.write(chunkText)
        }
      }

      await ChatgptMessage.createMany([
        {
          conversationId: conversation.id,
          model: model,
          role: 'user',
          content: prompt,
          tokensCount: this.getTokenCount(prompt, model),
          type: 'text',
        },
        {
          conversationId: conversation.id,
          model: model,
          role: 'assistant',
          content: modelResponse,
          tokensCount: this.getTokenCount(modelResponse, model),
          type: 'text',
        },
      ])

      if (messages.length === 0) {
        conversation.title = prompt.split(' ').slice(0, 5).join(' ')
        await conversation.save()
      }

      response.response.end()
    } catch (e) {
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
    const { prompt, model } = request.all()
    if (!prompt || !model) {
      return response.unprocessableEntity()
    }

    const conversation = await ChatgptConversation.find(conversationId)
    if (!conversation) return response.notFound()
    if (conversation.userId !== user.id) return response.forbidden()

    return await this.ask(context, prompt, model, conversation)
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
      .orderBy('id', 'desc')
      .offset((page - 1) * PER_PAGE)
      .limit(PER_PAGE)
      .exec()

    return {
      conversations: conversations,
    }
  }

  async updateMessage(context: HttpContext) {
    const { request, response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])

    const { prompt, model } = request.all()
    if (!prompt || !model) {
      return response.unprocessableEntity()
    }

    const messageId = params.id
    const message = await ChatgptMessage.find(messageId)
    if (!message) return response.notFound()
    if (message.role !== 'user') return response.badRequest()
    const conversation = await ChatgptConversation.find(message.conversationId)
    if (!conversation) return response.notFound()
    if (conversation.userId !== user.id) return response.forbidden()

    const createdAt = message.createdAt.toSQL()!
    await ChatgptMessage.query()
      .where('conversation_id', conversation.id)
      .where('created_at', '>=', createdAt)
      .delete()

    return await this.ask(context, prompt, model, conversation)
  }

  async generateImage(context: HttpContext) {
    const { request, response, auth, params } = context
    const user = await auth.authenticateUsing(['api'])
  }
}
