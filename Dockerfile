FROM node:26-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/model ./src/model
COPY README.md CLAUDE.md MCP.md ./
EXPOSE 5454
CMD ["./node_modules/.bin/tsx", "server/standalone.ts"]
