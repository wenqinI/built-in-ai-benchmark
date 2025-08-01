// Get references to DOM elements
const promptInput = document.getElementById('promptInput');
const generateResponseButton = document.getElementById('generateResponseButton');
const benchmarkButton = document.getElementById('benchmarkButton');
const outputDiv = document.getElementById('output');
const statusOutputDiv = document.getElementById('statusOutput');
const benchmarkResultsTableDiv = document.getElementById('benchmarkResultsTable');

let webGpuAvailable = false; // Flag to track WebGPU availability
let session = null; // Session still tracked globally to manage closing if needed

// Flags for controlling button state based on user's choice
let selectedMode = null; // 'single' if generate response clicked, 'benchmark' if benchmark clicked
let isOperationActive = false; // True when generate or benchmark is actively running

// --- Helper Functions ---

// Function to update the main LLM response output div
function updateOutput(message) {
    outputDiv.textContent = message;
}

// Function to update the separate status output div
function updateStatus(message) {
    statusOutputDiv.textContent = message;
}

/**
 * Handles the creation of a LanguageModel session.
 * This function is now called internally by generateResponse and runBenchmark.
 * @returns {Promise<boolean>} True if session was successfully created, false otherwise.
 */
async function ensureSessionCreated(roundInfo = "") {
    if (!webGpuAvailable) {
        updateStatus("WebGPU is not available. Cannot create session.");
        return false;
    }

    if (session) {
        // If a session already exists (e.g., from a previous single generation before a new one), close it.
        // For benchmark, the loop handles closing explicitly, but this handles single generations.
        try {
            if (session.close) {
                await session.close();
            }
            session = null;
        } catch (closeError) {
            console.warn("Error closing existing session:", closeError);
        }
    }

    updateStatus(`Creating session${roundInfo}... This may take a moment.`);
    outputDiv.textContent = `Creating Session${roundInfo}...`;

    try {
        const available = await LanguageModel.availability();
        if (available !== "available" && available !== "downloadable") {
            throw new Error('Built-in AI (Prompt API) is not available or enabled in this browser.');
        }

        session = await LanguageModel.create({
            monitor(m) {
                m.addEventListener('downloadprogress', (e) => {
                    updateStatus(`Downloading model${roundInfo}: ${Math.round(e.loaded * 100)}%`);
                });
            },
        });
        updateStatus(`Session created${roundInfo}.`);
        return true;
    } catch (error) {
        console.error("Failed to create session:", error);
        updateStatus(`Error creating session${roundInfo}: ${error.message}`);
        session = null;
        return false;
    }
}


function setButtonStates() {
    promptInput.disabled = isOperationActive || !webGpuAvailable;

    if (!webGpuAvailable) {
        generateResponseButton.disabled = true;
        benchmarkButton.disabled = true;
        return;
    }

    if (selectedMode === 'single') {
        // If 'generate response' was clicked
        generateResponseButton.disabled = isOperationActive; // Temporarily disabled while generating
        benchmarkButton.disabled = true; // Permanently disable benchmark button
    } else if (selectedMode === 'benchmark') {
        // If 'benchmark' was clicked
        generateResponseButton.disabled = true; // Permanently disable generate button
        benchmarkButton.disabled = isOperationActive; // Temporarily disabled while benchmarking
    } else {
        // Initial state: no mode selected yet
        generateResponseButton.disabled = false;
        benchmarkButton.disabled = false;
    }
}

async function detectWebGPU() {
    if ("gpu" in navigator) {
        webGpuAvailable = true;
        await logGpuInfo();
    } else {
        webGpuAvailable = false;
        updateStatus("WebGPU is not available in this browser. This app requires a browser with WebGPU support.");
        console.warn("WebGPU is not available in this browser.");
    }
    setButtonStates();
}

async function logGpuInfo() {
    try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
            console.log("GPU Adapter Info:", adapter.info);
        } else {
            console.warn("Could not retrieve GPU adapter.");
        }
    } catch (error) {
        console.error("Error retrieving GPU adapter info:", error);
    }
}

// --- Core Inference Function (Reusable for both single generation and benchmark) ---
async function performGeneration(userPrompt, isWarmup = false) {
    if (!userPrompt) {
        throw new Error("Please enter a prompt.");
    }

    let fullResponse = "";
    let first_chunk_time = null;
    let first_chunk_content = null;
    let generated_chunks = 0;

    const prompt_tokens = await session.measureInputUsage(userPrompt);
    const start_time = performance.now();
    const stream = session.promptStreaming(userPrompt);

    for await (const chunk of stream) {
        generated_chunks++;

        if (!first_chunk_time) {
            first_chunk_time = performance.now();
            first_chunk_content = chunk;
        }

        fullResponse += chunk;
        if (!isWarmup) {
            updateOutput(fullResponse);
        }
    }

    const end_time = performance.now();

    const time_to_first_chunk = first_chunk_time - start_time;
    const decode_time = end_time - first_chunk_time;
    const e2e_time = end_time - start_time;

    const total_tokens_used = await session.measureInputUsage(userPrompt + fullResponse);
    const generated_tokens = total_tokens_used - prompt_tokens;

    const chunks_per_second_e2e = generated_chunks / e2e_time * 1000;
    const prompt_tps = prompt_tokens / time_to_first_chunk * 1000;
    const decode_cps = (generated_chunks > 1 && decode_time > 0) ? (generated_chunks - 1) / decode_time * 1000 : 0;
    const decode_tps = (generated_tokens > 1 && decode_time > 0) ? (generated_tokens - 1) / decode_time * 1000 : 0;
    const tokens_per_seconds_e2e = (generated_tokens > 0 && e2e_time > 0) ? generated_tokens / e2e_time * 1000 : 0;

    const first_chunk_has_content = first_chunk_content ? `"${first_chunk_content}"` : "N/A";

    return {
        fullResponse,
        metrics: {
            prompt_tokens,
            generated_chunks,
            generated_tokens,
            chunks_per_second_e2e,
            tokens_per_seconds_e2e,
            prompt_tps,
            decode_cps,
            decode_tps,
            time_to_first_chunk,
            decode_time,
            e2e_time,
            first_chunk_content: first_chunk_has_content,
            total_tokens_used
        }
    };
}

// --- Single Inference Logic ---
async function generateResponse() {
    // Clear all previous results immediately
    outputDiv.textContent = "";
    statusOutputDiv.textContent = "";
    benchmarkResultsTableDiv.innerHTML = '';

    selectedMode = 'single'; // Set mode when this button is clicked
    isOperationActive = true; // Indicate operation is active
    setButtonStates();

    try {
        const userPrompt = promptInput.value.trim();
        if (!userPrompt) {
            updateStatus("Please enter a prompt.");
            return;
        }

        const sessionCreated = await ensureSessionCreated();
        if (!sessionCreated) {
            return;
        }

        updateStatus("Generating response...");
        const { fullResponse, metrics } = await performGeneration(userPrompt);

        // Display the response in the output div
        updateOutput(fullResponse);
        updateStatus("Response generated. Metrics displayed in the table below.");

        // Call displayBenchmarkTable to show the metrics for this single run
        displayBenchmarkTable([metrics], {}, 1);

    } catch (error) {
        console.error("Error generating response:", error);
        updateStatus(`Error: ${error.message}`);
    } finally {
        if (session) {
            try {
                if (session.close) {
                    await session.close();
                }
                session = null;
            } catch (closeError) {
                console.warn("Error closing session after single generation:", closeError);
            }
        }
        isOperationActive = false; // Operation finished
        setButtonStates();
    }
}


/**
 * Generates and displays an HTML table for benchmark results.
 * @param {Array<Object>} allMetrics - An array of metrics objects for each round.
 * @param {Object} avgMetrics - An object containing the average metrics.
 * @param {number} numRounds - The total number of benchmark rounds.
*/
function displayBenchmarkTable(allMetrics, avgMetrics, numRounds) {
    // Clear previous content
    benchmarkResultsTableDiv.innerHTML = '';

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    // Create table header
    const headerRow = document.createElement('tr');
    headerRow.innerHTML = `<th>Metric</th>`;
    // Only show "Round X" headers for actual benchmark runs (numRounds > 1)
    if (numRounds > 1) {
        for (let i = 0; i < numRounds; i++) {
            headerRow.innerHTML += `<th>Round ${i + 1}</th>`;
        }
        headerRow.innerHTML += `<th>Average</th>`; // Only show average column for multi-round benchmarks
    } else { // For a single run, just label it "Result"
        headerRow.innerHTML += `<th>Result</th>`;
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Define the order and display names for the metrics
    const metricOrder = [
        { key: 'prompt_tokens', name: 'Prompt Tokens' },
        { key: 'generated_chunks', name: 'Total Generated Chunks' },
        { key: 'generated_tokens', name: 'Total Generated Tokens (API measured)' },
        { key: 'time_to_first_chunk', name: 'Time to First Chunk [seconds]', isTime: true },
        { key: 'decode_time', name: 'Decode Time [seconds]', isTime: true },
        { key: 'e2e_time', name: 'End-to-End Time [seconds]', isTime: true },
        { key: 'decode_cps', name: 'Decode Chunks Per Second' },
        { key: 'decode_tps', name: 'Decode Tokens Per Second (API measured)' },
        { key: 'chunks_per_second_e2e', name: 'E2E Chunks Per Second' },
        { key: 'tokens_per_seconds_e2e', name: 'E2E Tokens Per Second (API measured)' },
    ];

    // Populate table body
    metricOrder.forEach(metric => {
        const row = document.createElement('tr');
        const metricNameCell = document.createElement('td');
        metricNameCell.textContent = metric.name;
        row.appendChild(metricNameCell);

        // Add data for each round/result
        allMetrics.forEach(roundMetrics => {
            const cell = document.createElement('td');
            let value = roundMetrics[metric.key];
            if (metric.isTime) {
                value = (value / 1000).toFixed(2); // Convert ms to s
            } else if (typeof value === 'number') {
                value = value.toFixed(2); // Format numbers to 2 decimal places
            } else if (metric.key === 'first_chunk_content') {
                value = value.replace(/"/g, '');
            }
            cell.textContent = value;
            row.appendChild(cell);
        });

        // Add average column ONLY if numRounds > 1
        if (numRounds > 1) {
            const avgCell = document.createElement('td');
            let avgValue = avgMetrics[metric.key];
            if (metric.isTime && typeof avgValue === 'number') {
                avgValue = (avgValue / 1000).toFixed(2); // Convert avg ms to s
            } else if (typeof avgValue === 'number') {
                avgValue = avgValue.toFixed(2); // Format avg numbers to 2 decimal places
            } else if (metric.key === 'first_chunk_content') {
                avgValue = avgValue ? avgValue.replace(/"/g, '') : "N/A";
            } else {
                avgValue = "N/A"; // For metrics that aren't numeric/averaged
            }
            avgCell.textContent = avgValue;
            row.appendChild(avgCell);
        }

        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    benchmarkResultsTableDiv.appendChild(table);
}


// --- Benchmark Logic ---
async function runBenchmark() {
    // Clear all previous results immediately
    outputDiv.textContent = "";
    statusOutputDiv.textContent = "";
    benchmarkResultsTableDiv.innerHTML = '';

    selectedMode = 'benchmark'; // Set mode when this button is clicked
    isOperationActive = true; // Indicate operation is active
    setButtonStates(); // Update button states immediately

    const NUM_ROUNDS = 5;
    const userPrompt = promptInput.value.trim();
    const warmupPrompt = "Hello, how are you?";

    if (!userPrompt) {
        updateStatus("Please enter a prompt for benchmarking.");
        return;
    }

    updateStatus("Starting benchmark...");

    const allMetrics = [];

    try {
        for (let i = 0; i < NUM_ROUNDS; i++) {
            if (session) {
                try {
                    if (session.close) {
                        await session.close();
                    }
                    session = null;
                } catch (closeError) {
                    console.warn("Error closing previous session:", closeError);
                }
            }

            const sessionCreated = await ensureSessionCreated(` for round ${i + 1}/${NUM_ROUNDS}`);
            if (!sessionCreated) {
                continue;
            }

            updateStatus(`Running warm-up for round ${i + 1}/${NUM_ROUNDS}...`);
            outputDiv.textContent = `Benchmarking... Warm-up for Round ${i + 1}/${NUM_ROUNDS}`;
            await performGeneration(warmupPrompt, true);

            updateStatus(`Running measured round ${i + 1}/${NUM_ROUNDS}...`);
            outputDiv.textContent = `Benchmarking... Measured Round ${i + 1}/${NUM_ROUNDS}`;
            const { fullResponse, metrics } = await performGeneration(userPrompt);

            allMetrics.push(metrics);

            updateStatus(`Measured round ${i + 1}/${NUM_ROUNDS} completed.`);
        }

        // Calculate and display averages
        const avgMetrics = allMetrics.reduce((acc, current) => {
            for (const key in current) {
                if (typeof current[key] === 'number') {
                    acc[key] = (acc[key] || 0) + current[key];
                }
            }
            return acc;
        }, {});

        for (const key in avgMetrics) {
            if (typeof avgMetrics[key] === 'number') { // Ensure we only divide numbers
                avgMetrics[key] /= NUM_ROUNDS;
            }
        }

        // Display the benchmark results in a table
        displayBenchmarkTable(allMetrics, avgMetrics, NUM_ROUNDS);

        updateStatus(`Benchmark complete after ${NUM_ROUNDS} rounds. Results displayed below.`);
        outputDiv.textContent = "Benchmark results are in the table below."; // Clear LLM response area
        console.log("Benchmark Averages:", avgMetrics);

    } catch (error) {
        console.error("Error during benchmark:", error);
        updateStatus(`Benchmark Error: ${error.message}`);
    } finally {
        if (session) {
            try {
                if (session.close) {
                    await session.close();
                }
                session = null;
            } catch (closeError) {
                console.warn("Error closing session after benchmark:", closeError);
            }
        }
        isOperationActive = false; // Operation finished
        setButtonStates();
    }
}


// --- Event Listeners ---
generateResponseButton.addEventListener('click', generateResponse);
benchmarkButton.addEventListener('click', runBenchmark);

// --- Initial Setup on Page Load ---
window.addEventListener('load', detectWebGPU);