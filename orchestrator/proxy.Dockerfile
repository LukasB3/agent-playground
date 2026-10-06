# Key proxy image: three compiled files on a distroless base, no shell.
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=build /src/dist/proxy.js /src/dist/proxy-main.js /src/dist/token.js ./
COPY --from=build /src/package.json ./
EXPOSE 8080
CMD ["proxy-main.js"]
