import fs from "fs"
import csv from "csv-parser"
import axios from "axios"
import nodeCron from 'node-cron';

interface CsvRow {
  Name: string
  "Phone Number": string
  Value: string
}

interface ProcessedMessage {
  phoneNumber: string
  name: string
  value: string
  message: string
}

class MessageProcessor {
  private logFilePath: string
  private csvFilePath: string
  private messageTemplate: string
  private apiUrl: string
  private sentPhoneNumbers: Set<string>

  constructor(
    csvFilePath: string = "./data.csv",
    logFilePath: string = "./sent_log.txt",
    messageTemplate: string = `Halo bapak / ibu [1], saya Rut dari tim Inspeksi aice pusat di Jakarta ingin konfirmasi.\nApakah benar pada bulan Juni toko bapak/ibu benar melakukan pemesanan eskrim sebanyak [2] dus ke distributor?\n\nTerimakasih atas konfirmasinya, Have an aice day!`,
    apiUrl: string = "https://app.wapanels.com/api/create-message" // Replace with your actual API URL
  ) {
    this.csvFilePath = csvFilePath
    this.logFilePath = logFilePath
    this.messageTemplate = messageTemplate
    this.apiUrl = apiUrl
    this.sentPhoneNumbers = new Set()
  }

  /**
   * Load previously sent phone numbers from log file
   */
  private loadSentPhoneNumbers(): void {
    try {
      if (fs.existsSync(this.logFilePath)) {
        const logContent = fs.readFileSync(this.logFilePath, "utf8")
        const phoneNumbers = logContent
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => line.split(",")[0]) // Get phone number (first column)
          .filter((phone) => phone)

        this.sentPhoneNumbers = new Set(phoneNumbers)
        console.log(
          `📋 Loaded ${this.sentPhoneNumbers.size} previously sent phone numbers`
        )
      } else {
        console.log("📋 No previous log file found, starting fresh")
      }
    } catch (error) {
      console.error("❌ Error loading sent phone numbers:", error)
      this.sentPhoneNumbers = new Set()
    }
  }

  /**
   * Log a sent phone number with timestamp
   */
  private logSentPhoneNumber(phoneNumber: string, name: string): void {
    const timestamp = new Date().toISOString()
    const logEntry = `${phoneNumber},${name},${timestamp}\n`

    try {
      fs.appendFileSync(this.logFilePath, logEntry)
      this.sentPhoneNumbers.add(phoneNumber)
    } catch (error) {
      console.error("❌ Error writing to log file:", error)
    }
  }

  /**
   * Parse message template with placeholders
   */
  private parseMessage(template: string, name: string, value: string): string {
    const replacements: Record<string, string> = {
      "[1]": name,
      "[2]": value,
    }

    return template.replace(
      /\[(\d+)]/g,
      (match, index) => {
        return replacements[match]
      }
    )
  }

  /**
   * Read and parse CSV file
   */
  private async readCsvFile(): Promise<CsvRow[]> {
    return new Promise((resolve, reject) => {
      const results: CsvRow[] = []

      if (!fs.existsSync(this.csvFilePath)) {
        reject(new Error(`CSV file not found: ${this.csvFilePath}`))
        return
      }

      fs.createReadStream(this.csvFilePath)
        .pipe(csv())
        .on("data", (data: CsvRow) => {
          // Skip if phone number was already sent
          if (!this.sentPhoneNumbers.has(data["Phone Number"])) {
            results.push(data)
          }
        })
        .on("end", () => {
          resolve(results)
        })
        .on("error", (error) => {
          reject(error)
        })
    })
  }

  /**
   * Send message to API
   */
  private async sendToApi(
    processedMessage: ProcessedMessage
  ): Promise<boolean> {
    try {
      const payload = {
        appkey: "53c00974-5c61-47cd-aaa5-51604c37f5b9",
        authkey: "cZsgEsVoFrFUkDSA0DPDPNYL7DKArKzQl87ighFzl6pKztY52i",
        to: processedMessage.phoneNumber,
        message: processedMessage.message,
      }

      // Replace with your actual API call
      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 10000, // 10 second timeout
      })

      if (
        response.status >= 200 &&
        response.status < 300 &&
        isJson(JSON.stringify(response.data))
      ) {
        console.log(
          `✅ Message sent to ${processedMessage.phoneNumber} (${processedMessage.name})`
        )
        return true
      } else {
        console.error(
          `❌ API returned status ${response.status} for ${processedMessage.phoneNumber}`
        )
        return false
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(
          `❌ API error for ${processedMessage.phoneNumber}:`,
          error.response?.data || error.message
        )
      } else {
        console.error(
          `❌ Unexpected error for ${processedMessage.phoneNumber}:`,
          error
        )
      }
      return false
    }
  }

  /**
   * Add delay between API calls to avoid rate limiting
   */
  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * Process messages with batching support
   */
  async processMessages(
    delayMs: number = 1000,
    batchSize?: number,
    startIndex: number = 0
  ): Promise<void> {
    try {
      console.log("🚀 Starting message processing...")

      // Load previously sent phone numbers
      this.loadSentPhoneNumbers()

      // Read CSV file
      console.log("📖 Reading CSV file...")
      const csvData = await this.readCsvFile()

      if (csvData.length === 0) {
        console.log("✅ All messages have been sent already!")
        return
      }

      // Apply batching if specified
      let dataToProcess = csvData
      let batchInfo = ""

      if (batchSize && batchSize > 0) {
        const endIndex = Math.min(startIndex + batchSize, csvData.length)
        dataToProcess = csvData.slice(startIndex, endIndex)
        batchInfo = ` (Batch: ${startIndex + 1}-${
          startIndex + dataToProcess.length
        } of ${csvData.length} total available)`

        console.log(
          `📊 Processing batch: rows ${startIndex + 1} to ${
            startIndex + dataToProcess.length
          }`
        )
        console.log(
          `📊 Batch size: ${dataToProcess.length} messages${batchInfo}`
        )

        if (dataToProcess.length === 0) {
          console.log("✅ No more messages to process in this batch range!")
          return
        }
      } else {
        console.log(`📊 Found ${csvData.length} new messages to process`)
      }

      let successCount = 0
      let errorCount = 0

      // Process each row in the batch
      for (let i = 0; i < dataToProcess.length; i++) {
        const row = dataToProcess[i]
        const globalIndex = startIndex + i + 1

        console.log(
          `\n📤 Processing ${i + 1}/${
            dataToProcess.length
          } (Global: ${globalIndex}): ${row.Name} (${row["Phone Number"]})`
        )

        // Create processed message
        const processedMessage: ProcessedMessage = {
          phoneNumber: row["Phone Number"],
          name: row.Name,
          value: row.Value,
          message: this.parseMessage(this.messageTemplate, row.Name, row.Value),
        }

        console.log(`💬 Message: "${processedMessage.message}"`)

        // Send to API
        const success = await this.sendToApi(processedMessage)

        if (success) {
          // Log successful send
          this.logSentPhoneNumber(
            processedMessage.phoneNumber,
            processedMessage.name
          )
          successCount++
        } else {
          errorCount++
        }

        // Add delay between requests (except for the last one)
        if (i < dataToProcess.length - 1) {
          console.log(`⏳ Waiting ${success ? delayMs : 1000}ms...`)
          await this.delay(success ? delayMs : 1000)
        }
      }

      console.log(`\n🎉 Batch processing completed!${batchInfo}`)
      console.log(`✅ Successful: ${successCount}`)
      console.log(`❌ Errors: ${errorCount}`)
      console.log(`📋 Total sent (all time): ${this.sentPhoneNumbers.size}`)

      // Show next batch info if applicable
      if (batchSize && startIndex + batchSize < csvData.length) {
        const remainingCount = csvData.length - (startIndex + batchSize)
        console.log(
          `\n📋 Next batch available: ${remainingCount} messages remaining`
        )
        console.log(
          `💡 To process next batch, use: startIndex = ${
            startIndex + batchSize
          }`
        )
      }
    } catch (error) {
      console.error("💥 Fatal error during processing:", error)
      throw error
    }
  }

  /**
   * Process a specific batch by batch number (1-based)
   */
  async processBatch(
    batchNumber: number,
    batchSize: number = 100,
    delayMs: number = 1000
  ): Promise<void> {
    const startIndex = (batchNumber - 1) * batchSize
    console.log(`🎯 Processing Batch ${batchNumber} (Size: ${batchSize})`)
    await this.processMessages(delayMs, batchSize, startIndex)
  }

  /**
   * Get statistics about sent messages
   */
  getStats(): { totalSent: number; logFilePath: string } {
    return {
      totalSent: this.sentPhoneNumbers.size,
      logFilePath: this.logFilePath,
    }
  }

  /**
   * Clear log file (use with caution!)
   */
  clearLog(): void {
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.unlinkSync(this.logFilePath)
        this.sentPhoneNumbers.clear()
        console.log("🗑️ Log file cleared")
      }
    } catch (error) {
      console.error("❌ Error clearing log file:", error)
    }
  }
}

// Main execution function
async function main() {
  const processor = new MessageProcessor()

  try {
    await processor.processBatch(1, 1000, 30000)

  } catch (error) {
    console.error("Application error:", error)
    process.exit(1)
  }
}

function isJson(str: unknown) {
  try {
    JSON.parse(String(str))
  } catch (e) {
    return false
  }
  return true
}

// Run if this file is executed directly
if (require.main === module) {
  main()
}

console.log('[WA-AICE] worker is starting', new Date());

nodeCron.schedule('* * * * *', () => {
  console.log('[WA-AICE] worker is running', new Date());
});

// nodeCron.schedule('0 8 * * *', () => {
//   console.log('[WA-AICE] worker 08:00 AM starting');
//   main()
// });