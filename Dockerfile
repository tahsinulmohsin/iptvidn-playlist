FROM node:18-alpine

# Install git for the auto-updater to push to GitHub
RUN apk add --no-cache git

WORKDIR /app

# Copy package info and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Set default port
ENV PORT=3000
EXPOSE 3000

# Start the worker
CMD ["npm", "start"]
