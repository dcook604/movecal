import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    user: {
      id: string;
      role: 'CONCIERGE' | 'COUNCIL' | 'PROPERTY_MANAGER';
      email: string;
      name: string;
    };
  }
}
