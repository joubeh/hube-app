import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import Verify from '#models/verify'
import { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'

export default class UserController {
  private async sendCode(phone: string) {
    const lastVerify = await Verify.query()
      .where('phone', phone)
      .orderBy('created_at', 'desc')
      .first()

    if (lastVerify) {
      const now = DateTime.now()
      const createdAt = lastVerify.createdAt
      const diffMinutes = now.diff(createdAt, 'minutes').minutes
      if (diffMinutes < 3) {
        return { ok: false, error: 'قبل از ارسال مجدد کد باید ۳دقیقه صبر کنید' }
      }
    }

    const code = Math.floor(1000 + Math.random() * 9000).toString()
    await Verify.create({
      phone: phone,
      code: code,
    })

    fetch('https://api.sms.ir/v1/send/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/plain',
        'x-api-key': env.get('SMS_API_KEY'),
      },
      body: JSON.stringify({
        mobile: phone,
        templateId: env.get('SMS_VERIFY_TEMPLATE_ID'),
        parameters: [
          {
            name: 'CODE',
            value: code,
          },
        ],
      }),
    }).catch(() => {})

    return { ok: true }
  }

  private async verifyCode(phone: string, code: string) {
    const lastVerify = await Verify.query()
      .where('phone', phone)
      .orderBy('created_at', 'desc')
      .first()

    if (!lastVerify) {
      return { ok: false, error: 'خطایی پیش آمده دوباره تلاش کنید' }
    }

    const now = DateTime.now()
    const createdAt = lastVerify.createdAt
    const diffMinutes = now.diff(createdAt, 'minutes').minutes
    if (diffMinutes > 15) {
      return { ok: false, error: 'کد منقضی شده است دوباره کد دریافت کنید' }
    }

    if (lastVerify.code !== code) {
      return { ok: false, error: 'کد اشتباه است' }
    }

    return { ok: true }
  }

  async auth({ request, response }: HttpContext) {
    const { phone } = request.all()
    if (!phone) {
      return response.unprocessableEntity()
    }
    const user = await User.findBy('phone', phone)
    if (user) {
      return { action: 'login' }
    }
    const result = await this.sendCode(phone)
    if (!result.ok) {
      return response.badRequest({ error: result.error })
    }
    return { action: 'register' }
  }

  async login({ request, response, auth }: HttpContext) {
    const { phone, password } = request.all()
    if (!phone || !password) {
      return response.unprocessableEntity()
    }

    const user = await User.findBy('phone', phone)
    if (!user) {
      return response.unprocessableEntity({ error: 'اطلاعات نادرست است' })
    }

    const isPasswordValid = await hash.verify(user.password, password)
    if (!isPasswordValid) {
      return response.unprocessableEntity({ error: 'اطلاعات نادرست است' })
    }

    const token = await auth.use('api').createToken(user)
    return { token }
  }

  async verify({ request, response }: HttpContext) {
    const { phone, code } = request.all()
    if (!phone || !code) {
      return response.unprocessableEntity()
    }

    const result = await this.verifyCode(phone, code)
    if (!result.ok) {
      return response.badRequest({ error: result.error })
    }

    return { ok: true }
  }

  async register({ request, response, auth }: HttpContext) {
    const { phone, code, name, password } = request.all()
    if (!phone || !code || !name || !password) {
      return response.unprocessableEntity()
    }

    const result = await this.verifyCode(phone, code)
    if (!result.ok) {
      return response.badRequest({ error: result.error })
    }
    await Verify.query().where('phone', phone).delete()

    const user = await User.create({
      name: name,
      phone: phone,
      password: password,
      wallet: 500000,
    })

    const token = await auth.use('api').createToken(user)
    return { token }
  }

  async forgotPassword({ request, response }: HttpContext) {
    const { phone } = request.all()
    if (!phone) {
      return response.unprocessableEntity()
    }
    const result = await this.sendCode(phone)
    if (!result.ok) {
      return response.badRequest({ error: result.error })
    }
    return { ok: true }
  }

  async resetPassword({ request, response, auth }: HttpContext) {
    const { phone, code, password } = request.all()
    if (!phone || !code || !password) {
      return response.unprocessableEntity()
    }

    const result = await this.verifyCode(phone, code)
    if (!result.ok) {
      return response.badRequest({ error: result.error })
    }
    await Verify.query().where('phone', phone).delete()

    const user = await User.findBy('phone', phone)
    if (!user) {
      return response.unprocessableEntity()
    }

    user.password = password
    await user.save()

    const token = await auth.use('api').createToken(user)
    return { token }
  }

  async logout({ auth }: HttpContext) {
    await auth.authenticateUsing(['api'])
    await auth.use('api').invalidateToken()
    return { ok: true }
  }

  async user({ auth }: HttpContext) {
    return await auth.authenticateUsing(['api'])
  }
}
