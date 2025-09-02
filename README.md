# Browser Built-in AI Simple Benchmark

A browser's built-in AI is a proposed feature that allows web developers to directly access and use the AI capabilities built into the browser (like Chrome or Edge) from their own website's code or browser extension's JavaScript code.

This repo is a demo usage of the build-in [Prompt API](https://github.com/webmachinelearning/prompt-api) and a simple benchmark.

---

## Browser Setup

To run this benchmark, you must first enable the experimental Prompt API. Follow the official instructions for your browser:

* **Chrome:** [Get started with built-in AI](https://developer.chrome.com/docs/ai/get-started#use_apis_on_localhost)
* **Edge:** [Prompt a built-in language model with the Prompt API](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/prompt-api#enable-the-prompt-api)

## Run the Benchmark
You can run the benchmark directly or host it locally.

### Run from the demo page (Recommended)
 
To run the benchmark, simply open [URL](https://www.google.com/search?q=https://wenqini.github.io/built-in-ai-benchmark/).

### Host Locally
1. **Clone the repository:**

    ```shell
    git clone https://github.com/wenqinI/built-in-ai-benchmark
    ```

2. **Open the file:**

    Navigate into the cloned directory and open the `index.html` file in the browser you just configured.

## Modes of Operation

The application provides two modes for testing the in-browser AI model.

### QA Mode

* **Function:** Manually send a single prompt to the AI model.
* **Output:** Displays the AI-generated response along with performance metrics for that single query. This is ideal for interactive testing.

### Benchmark Mode

* **Function:** Automatically sends a predefined prompt to the AI model for 5 consecutive rounds.
* **Output:** Calculates and displays the average performance metrics across all rounds, providing a more stable performance measurement.

## Performance Metrics

The Prompt API delivers its response in `chunk`s, where each chunk can contain one or more tokens. Consequently, the primary performance metric displayed is **chunks per second**.

The streaming nature of the API, which produces these chunks, is illustrated by the `promptStreaming` method:

```js
// Prompt the model and stream the result chunk by chunk
const stream = session.promptStreaming("Write me an extra-long poem.");
for await (const chunk of stream) {
  console.log(chunk);
}
```

To provide a more familiar metric, this benchmark also calculates **tokens per second**. This is achieved by using the `measureInputUsage()` method to convert the output string into tokens, as detailed in the [Prompt API documentation](https://github.com/webmachinelearning/prompt-api?tab=readme-ov-file#tokenization-context-window-length-limits-and-overflow).

---

## Contributing

Feedback and contributions are welcome! Feel free to open an issue to report bugs, suggest features, or submit a pull request with improvements.
