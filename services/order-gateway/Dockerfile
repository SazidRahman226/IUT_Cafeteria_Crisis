FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (only production dependencies are needed)
RUN npm install

# Copy application source
COPY . .

# Expose the API port
EXPOSE 5002

# Command to run the application
CMD ["npm", "start"]
