# Use an official Node.js runtime as a parent image
FROM node:22-alpine

# lightningcss needs native compilation on musl
RUN apk add --no-cache python3 make g++

# Set the working directory to /app
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package.json package-lock.json ./

# Install any needed packages specified in package.json
RUN npm ci

# Copy the rest of the application code to the working directory
COPY src ./src
COPY public ./public
COPY next.config.mjs .
COPY postcss.config.mjs .
COPY tsconfig.json .

# Build the app and run it
CMD ["npm", "run", "dev"]
