FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY bin ./bin
# The stdio server only uses Node built-ins and src/mcp.js tool definitions.
ENV NODE_ENV=production
ENTRYPOINT ["node", "bin/aliasflare-mcp.js"]
