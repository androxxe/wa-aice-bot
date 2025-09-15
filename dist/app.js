"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const csv_parser_1 = __importDefault(require("csv-parser"));
const axios_1 = __importDefault(require("axios"));
class MessageProcessor {
    constructor(csvFilePath = "./data.csv", successLogFilePath = "./sent_log.txt", errorLogFilePath = "./error_log.txt", messageTemplate = `Halo bapak / ibu Mitra Aice, saya dari tim Inspeksi aice pusat di Jakarta ingin konfirmasi\nApakah benar pada bulan Agustus toko bapak/ibu benar melakukan pemesanan eskrim totalnya sebanyak [2] dus ke distributor?\nTerimakasih atas konfirmasinya\nHave an aice day!`, apiUrl = "https://app.wapanels.com/api/create-message" // Replace with your actual API URL
    ) {
        this.csvFilePath = csvFilePath;
        this.successLogFilePath = successLogFilePath;
        this.errorLogFilePath = errorLogFilePath;
        this.messageTemplate = messageTemplate;
        this.apiUrl = apiUrl;
        this.sentPhoneNumbers = new Set();
        this.errorPhoneNumbers = new Set();
    }
    /**
     * Load previously sent phone numbers from log file
     */
    loadSentPhoneNumbers() {
        try {
            if (fs_1.default.existsSync(this.successLogFilePath)) {
                const successLogContent = fs_1.default.readFileSync(this.successLogFilePath, "utf8");
                const sentPhoneNumbers = successLogContent
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line) => line.split(",")[0]) // Get phone number (first column)
                    .filter((phone) => phone);
                this.sentPhoneNumbers = new Set(sentPhoneNumbers);
                const errorLogContent = fs_1.default.readFileSync(this.errorLogFilePath, "utf8");
                const errorPhoneNumbers = errorLogContent
                    .split("\n")
                    .filter((line) => line.trim())
                    .map((line) => line.split(",")[0]) // Get phone number (first column)
                    .filter((phone) => phone);
                this.errorPhoneNumbers = new Set(errorPhoneNumbers);
                console.log(`📋 Loaded ${this.sentPhoneNumbers.size} previously sent phone numbers and error phone numbers`);
            }
            else {
                console.log("📋 No previous log file found, starting fresh");
            }
        }
        catch (error) {
            console.error("❌ Error loading sent phone numbers:", error);
            this.sentPhoneNumbers = new Set();
            this.errorPhoneNumbers = new Set();
        }
    }
    /**
     * Log a sent phone number with timestamp
     */
    logSuccessSentPhoneNumber(phoneNumber, name) {
        const timestamp = new Date().toISOString();
        const logEntry = `${phoneNumber},${name},${timestamp}\n`;
        try {
            fs_1.default.appendFileSync(this.successLogFilePath, logEntry);
            this.sentPhoneNumbers.add(phoneNumber);
        }
        catch (error) {
            console.error("❌ Error writing to log file:", error);
        }
    }
    logErrorSentPhoneNumber(phoneNumber, name) {
        const timestamp = new Date().toISOString();
        const logEntry = `${phoneNumber},${name},${timestamp}\n`;
        try {
            fs_1.default.appendFileSync(this.errorLogFilePath, logEntry);
            this.errorPhoneNumbers.add(phoneNumber);
        }
        catch (error) {
            console.error("❌ Error writing to log file:", error);
        }
    }
    /**
     * Parse message template with placeholders
     */
    parseMessage(template, name, value) {
        const replacements = {
            "[1]": name,
            "[2]": value,
        };
        return template.replace(/\[(\d+)]/g, (match, index) => {
            return replacements[match];
        });
    }
    /**
     * Read and parse CSV file
     */
    async readCsvFile() {
        return new Promise((resolve, reject) => {
            const results = [];
            let totalRows = 0;
            let sentSkipped = 0;
            let errorSkipped = 0;
            if (!fs_1.default.existsSync(this.csvFilePath)) {
                reject(new Error(`CSV file not found: ${this.csvFilePath}`));
                return;
            }
            fs_1.default.createReadStream(this.csvFilePath)
                .pipe((0, csv_parser_1.default)())
                .on("data", (data) => {
                totalRows++;
                console.log(`Row ${totalRows}:`, {
                    name: data.Name,
                    phone: data["Phone Number"],
                    value: data.Value,
                });
                // Check if already sent successfully
                if (this.sentPhoneNumbers.has(data["Phone Number"])) {
                    sentSkipped++;
                    return;
                }
                // Check if in error log
                if (this.errorPhoneNumbers.has(data["Phone Number"])) {
                    errorSkipped++;
                    return;
                }
                // Check for missing required fields
                if (!data.Name || !data.Value || !data["Phone Number"]) {
                    return;
                }
                results.push(data);
            })
                .on("end", () => {
                console.log(`\n📊 CSV Processing Summary:`);
                console.log(`  Total rows in CSV: ${totalRows}`);
                console.log(`  Already sent successfully: ${sentSkipped}`);
                console.log(`  In error log: ${errorSkipped}`);
                console.log(`  Available for processing: ${results.length}`);
                console.log(`  Total in sent log: ${this.sentPhoneNumbers.size}`);
                console.log(`  Total in error log: ${this.errorPhoneNumbers.size}`);
                resolve(results);
            })
                .on("error", (error) => {
                reject(error);
            });
        });
    }
    /**
     * Send message to API
     */
    async sendToApi(processedMessage) {
        try {
            const payload = {
                appkey: "5dd15be3-dacb-4a8c-81c4-82cccd9b9348",
                authkey: "cZsgEsVoFrFUkDSA0DPDPNYL7DKArKzQl87ighFzl6pKztY52i",
                to: processedMessage.phoneNumber,
                message: processedMessage.message,
            };
            // Replace with your actual API call
            const response = await axios_1.default.post(this.apiUrl, payload, {
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                },
                timeout: 10000, // 10 second timeout
            });
            if (response.status >= 200 &&
                response.status < 300 &&
                isJson(JSON.stringify(response.data))) {
                console.log(`✅ Message sent to ${processedMessage.phoneNumber} (${processedMessage.name})`);
                return {
                    success: true,
                    statusCode: response.status,
                };
            }
            else {
                console.error(`❌ API returned status ${response.status} for ${processedMessage.phoneNumber}`);
                return {
                    success: false,
                    statusCode: response.status,
                };
            }
        }
        catch (error) {
            if (axios_1.default.isAxiosError(error)) {
                console.error(`❌ API error for ${processedMessage.phoneNumber}:`, error.response?.data || error.message);
            }
            else {
                console.error(`❌ Unexpected error for ${processedMessage.phoneNumber}:`, error);
            }
            return {
                success: false,
                statusCode: error?.response?.status || 500,
            };
        }
    }
    /**
     * Add delay between API calls to avoid rate limiting
     */
    async delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Process messages with batching support
     */
    async processMessages(delayMs = 1000, batchSize, startIndex = 0) {
        try {
            console.log("🚀 Starting message processing...");
            // Load previously sent phone numbers
            this.loadSentPhoneNumbers();
            // Read CSV file
            console.log("📖 Reading CSV file...");
            const csvData = await this.readCsvFile();
            if (csvData.length === 0) {
                console.log("✅ All messages have been sent already!");
                return;
            }
            // Apply batching if specified
            let dataToProcess = csvData;
            let batchInfo = "";
            if (batchSize && batchSize > 0) {
                const endIndex = Math.min(startIndex + batchSize, csvData.length);
                dataToProcess = csvData.slice(startIndex, endIndex);
                batchInfo = ` (Batch: ${startIndex + 1}-${startIndex + dataToProcess.length} of ${csvData.length} total available)`;
                console.log(`📊 Processing batch: rows ${startIndex + 1} to ${startIndex + dataToProcess.length}`);
                console.log(`📊 Batch size: ${dataToProcess.length} messages${batchInfo}`);
                if (dataToProcess.length === 0) {
                    console.log("✅ No more messages to process in this batch range!");
                    return;
                }
            }
            else {
                console.log(`📊 Found ${csvData.length} new messages to process`);
            }
            let successCount = 0;
            let errorCount = 0;
            // Process each row in the batch
            for (let i = 0; i < dataToProcess.length; i++) {
                const row = dataToProcess[i];
                const globalIndex = startIndex + i + 1;
                console.log(`\n📤 Processing ${i + 1}/${dataToProcess.length} (Global: ${globalIndex}): ${row.Name} (${row["Phone Number"]})`);
                // Create processed message
                const processedMessage = {
                    phoneNumber: row["Phone Number"],
                    name: row.Name,
                    value: row.Value,
                    message: this.parseMessage(this.messageTemplate, row.Name, row.Value),
                };
                console.log(`💬 Message: "${processedMessage.message}"`);
                // Send to API
                const response = await this.sendToApi(processedMessage);
                if (response.success) {
                    // Log successful send
                    this.logSuccessSentPhoneNumber(processedMessage.phoneNumber, processedMessage.name);
                    successCount++;
                }
                else {
                    if (![502, 503, 504].includes(response.statusCode)) {
                        errorCount++;
                        this.logErrorSentPhoneNumber(processedMessage.phoneNumber, processedMessage.name);
                    }
                }
                // Add delay between requests (except for the last one)
                if (i < dataToProcess.length - 1) {
                    console.log(`⏳ Waiting ${response.success ? delayMs : 500}ms...`);
                    await this.delay(response.success ? delayMs : 500);
                }
            }
            console.log(`\n🎉 Batch processing completed!${batchInfo}`);
            console.log(`✅ Successful: ${successCount}`);
            console.log(`❌ Errors: ${errorCount}`);
            console.log(`📋 Total sent (all time): ${this.sentPhoneNumbers.size}`);
            // Show next batch info if applicable
            if (batchSize && startIndex + batchSize < csvData.length) {
                const remainingCount = csvData.length - (startIndex + batchSize);
                console.log(`\n📋 Next batch available: ${remainingCount} messages remaining`);
                console.log(`💡 To process next batch, use: startIndex = ${startIndex + batchSize}`);
            }
        }
        catch (error) {
            console.error("💥 Fatal error during processing:", error);
            throw error;
        }
    }
    /**
     * Process a specific batch by batch number (1-based)
     */
    async processBatch(batchNumber, batchSize = 100, delayMs = 1000) {
        const startIndex = (batchNumber - 1) * batchSize;
        console.log(`🎯 Processing Batch ${batchNumber} (Size: ${batchSize})`);
        await this.processMessages(delayMs, batchSize, startIndex);
    }
    /**
     * Get statistics about sent messages
     */
    getStats() {
        return {
            totalSent: this.sentPhoneNumbers.size,
            successLogFilePath: this.successLogFilePath,
        };
    }
    /**
     * Clear log file (use with caution!)
     */
    clearLog() {
        try {
            if (fs_1.default.existsSync(this.successLogFilePath)) {
                fs_1.default.unlinkSync(this.successLogFilePath);
                this.sentPhoneNumbers.clear();
                this.errorPhoneNumbers.clear();
                console.log("🗑️ Log file cleared");
            }
        }
        catch (error) {
            console.error("❌ Error clearing log file:", error);
        }
    }
}
// Main execution function
async function main() {
    const processor = new MessageProcessor();
    try {
        await processor.processBatch(1, 150, 30000);
    }
    catch (error) {
        console.error("Application error:", error);
        process.exit(1);
    }
}
function isJson(str) {
    try {
        JSON.parse(String(str));
    }
    catch (e) {
        return false;
    }
    return true;
}
// Run if this file is executed directly
if (require.main === module) {
    main();
}
console.log("[WA-AICE] worker is starting", new Date());
// nodeCron.schedule('* * * * *', () => {
//   console.log('[WA-AICE] worker is running', new Date());
// });
// nodeCron.schedule('0 8 * * *', () => {
//   console.log('[WA-AICE] worker 08:00 AM starting');
//   main()
// });
//# sourceMappingURL=app.js.map