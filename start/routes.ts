import router from '@adonisjs/core/services/router'
const UsersController = () => import('#controllers/users_controller')

router.post('/api/auth', [UsersController, 'auth'])
router.post('/api/login', [UsersController, 'login'])
router.post('/api/verify', [UsersController, 'verify'])
router.post('/api/register', [UsersController, 'register'])
router.post('/api/forgot-password', [UsersController, 'forgotPassword'])
router.post('/api/reset-password', [UsersController, 'resetPassword'])
router.post('/api/logout', [UsersController, 'logout'])
router.get('/api/user', [UsersController, 'user'])

router.get('/', async () => {
  return {
    hello: 'world',
  }
})
