FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Skip the Electron binary download — only the web build is needed here
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci
COPY . .
RUN npm run build:web

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
