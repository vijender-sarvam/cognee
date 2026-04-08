# Use Debian-based Node (lightningcss needs glibc, not musl/Alpine)
FROM node:22-slim

# Set the working directory to /app
WORKDIR /app

# Copy package.json and package-lock.json to the working directory
COPY package.json package-lock.json ./

# Install deps + force the correct lightningcss platform binary
RUN npm install --prefer-offline && npm install lightningcss-linux-x64-gnu

# Copy the rest of the application code to the working directory
COPY src ./src
COPY public ./public
COPY next.config.mjs .
COPY postcss.config.mjs .
COPY tsconfig.json .

# Build the app and run it
CMD ["npm", "run", "dev"]
