import env from '#start/env'
import OpenAI from 'openai'

const apiKey = env.get('OPENAI_API_KEY')
if (!apiKey) {
  throw new Error('OpenAI API key is missing')
}

const openai = new OpenAI({ apiKey })

export default openai
