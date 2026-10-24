FROM node:24-bookworm-slim
WORKDIR /app
# Native dependency better-sqlite3 may need compilation when a prebuilt binary is unavailable.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npm run typecheck && npm test
RUN mkdir -p /app/data
ENV PORT=3001 DB_PATH=/app/data/habits.sqlite
EXPOSE 3001
CMD ["npm", "run", "start"]
