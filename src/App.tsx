import { useState, useCallback, useRef } from 'react';
import {
  Send,
  Ship,
  Loader2,
  Image,
  FileText,
  Code,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
} from 'lucide-react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

interface LabelResult {
  format: 'ZPL' | 'PDF' | 'PNG';
  requestedFormatCode: 1 | 2 | 3;
  requestId: string | null;
  labelData: string | null;
  labelSrc: string | null;
  detectedContentType: 'PNG' | 'PDF' | 'ZPL' | 'UNKNOWN';
  response: unknown;
  rawResponse: string;
  error: string | null;
  isLoading: boolean;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const defaultPayload = `{
  "carrierCode": "EXAMPLE_CARRIER",
  "shipmentId": "SHIP-12345",
  "orderId": "ORD-67890",
  "recipient": {
    "name": "John Doe",
    "address": "123 Main Street",
    "city": "Copenhagen",
    "postalCode": "1000",
    "country": "DK"
  },
  "weight": {
    "value": 2.5,
    "unit": "kg"
  },
  "dimensions": {
    "length": 30,
    "width": 20,
    "height": 15,
    "unit": "cm"
  },
  "service": "STANDARD"
}`;

const defaultUrl = 'https://api.example.com/carriers/labels';
const supportedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type HttpMethod = (typeof supportedMethods)[number];

function App() {
  const [url, setUrl] = useState(defaultUrl);
  const [requestMethod, setRequestMethod] = useState<HttpMethod>('POST');
  const [payload, setPayload] = useState(defaultPayload);
  const [customHeaders, setCustomHeaders] = useState('{}');
  const [allowInsecureTls, setAllowInsecureTls] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState<Record<'ZPL' | 'PDF' | 'PNG', boolean>>({
    ZPL: false,
    PDF: false,
    PNG: false,
  });
  const [formatSelectionError, setFormatSelectionError] = useState<string | null>(null);
  const [results, setResults] = useState<LabelResult[]>([]);
  const [expandedResponses, setExpandedResponses] = useState<Record<string, boolean>>({});
  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [currentPayloadLine, setCurrentPayloadLine] = useState(1);
  const requestCounterRef = useRef(1);
  const payloadTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const payloadGutterRef = useRef<HTMLDivElement | null>(null);
  const payloadHighlightRef = useRef<HTMLDivElement | null>(null);

  const payloadLineNumbers = Array.from(
    { length: Math.max(1, payload.split('\n').length) },
    (_, index) => index + 1
  );

  const syncPayloadGutterScroll = () => {
    if (!payloadTextareaRef.current || !payloadGutterRef.current || !payloadHighlightRef.current) return;
    payloadGutterRef.current.scrollTop = payloadTextareaRef.current.scrollTop;
    payloadHighlightRef.current.scrollTop = payloadTextareaRef.current.scrollTop;
    payloadHighlightRef.current.scrollLeft = payloadTextareaRef.current.scrollLeft;
  };

  const toggleFormatSelection = (format: 'ZPL' | 'PDF' | 'PNG') => {
    setSelectedFormats((prev) => ({
      ...prev,
      [format]: !prev[format],
    }));
    setFormatSelectionError(null);
  };

  const updateCurrentPayloadLine = () => {
    if (!payloadTextareaRef.current) return;
    const cursor = payloadTextareaRef.current.selectionStart;
    const line = payloadTextareaRef.current.value.slice(0, cursor).split('\n').length;
    setCurrentPayloadLine(line);
  };

  const handlePayloadKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab') return;

    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const nextValue = `${payload.slice(0, start)}  ${payload.slice(end)}`;

    setPayload(nextValue);
    requestAnimationFrame(() => {
      if (!payloadTextareaRef.current) return;
      payloadTextareaRef.current.selectionStart = start + 2;
      payloadTextareaRef.current.selectionEnd = start + 2;
      updateCurrentPayloadLine();
      syncPayloadGutterScroll();
    });
  };

  const renderJsonHighlightedLine = (line: string) => {
    const tokenRegex =
      /("(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|true|false|null|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|(?:\{|\}|\[|\]|,|:))/g;
    const nodes: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tokenRegex.exec(line)) !== null) {
      const [token] = match;
      const index = match.index;

      if (index > lastIndex) {
        nodes.push(line.slice(lastIndex, index));
      }

      let className = 'text-gray-700';
      if (/^".*"$/.test(token) && /"\s*:$/.test(`${token}${line.slice(tokenRegex.lastIndex).match(/^\s*:/)?.[0] || ''}`)) {
        className = 'text-blue-700';
      } else if (/^".*"$/.test(token)) {
        className = 'text-emerald-700';
      } else if (/^(true|false)$/.test(token)) {
        className = 'text-purple-700';
      } else if (/^null$/.test(token)) {
        className = 'text-rose-600';
      } else if (/^-?\d/.test(token)) {
        className = 'text-amber-700';
      } else if (token.length === 1 && '{}[],:'.includes(token)) {
        className = 'text-slate-500';
      }

      nodes.push(
        <span key={`${index}-${token}`} className={className}>
          {token}
        </span>
      );
      lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < line.length) {
      nodes.push(line.slice(lastIndex));
    }

    return nodes;
  };

  const getNestedValue = useCallback((obj: unknown, path: string): unknown => {
    if (typeof obj !== 'object' || obj === null) return undefined;
    return path.split('.').reduce<unknown>((acc, segment) => {
      if (typeof acc !== 'object' || acc === null) return undefined;
      return (acc as Record<string, unknown>)[segment];
    }, obj);
  }, []);

  const looksLikeDataUri = (value: string) => /^data:[^;]+;base64,/i.test(value);
  const looksLikeHttpUrl = (value: string) => /^https?:\/\//i.test(value);

  const sanitizeBase64 = (value: string) => value.replace(/\s+/g, '');

  const isLikelyBase64 = (value: string) => {
    const cleaned = sanitizeBase64(value);
    if (cleaned.length < 120) return false;
    if (cleaned.length % 4 !== 0) return false;
    return /^[A-Za-z0-9+/=]+$/.test(cleaned);
  };

  const collectStringValues = (input: unknown, bucket: string[], depth = 0) => {
    if (depth > 8 || input == null) return;

    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (trimmed.length > 0) bucket.push(trimmed);
      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) collectStringValues(item, bucket, depth + 1);
      return;
    }

    if (typeof input === 'object') {
      for (const value of Object.values(input as Record<string, unknown>)) {
        collectStringValues(value, bucket, depth + 1);
      }
    }
  };

  const collectValuesByKeyName = (
    input: unknown,
    keyMatcher: (key: string) => boolean,
    bucket: unknown[],
    depth = 0
  ) => {
    if (depth > 10 || input == null) return;

    if (Array.isArray(input)) {
      for (const item of input) collectValuesByKeyName(item, keyMatcher, bucket, depth + 1);
      return;
    }

    if (isObjectRecord(input)) {
      for (const [key, value] of Object.entries(input)) {
        if (keyMatcher(key)) {
          bucket.push(value);
        }
        collectValuesByKeyName(value, keyMatcher, bucket, depth + 1);
      }
    }
  };

  const detectContentType = (value: string | null): 'PNG' | 'PDF' | 'ZPL' | 'UNKNOWN' => {
    if (!value) return 'UNKNOWN';

    const trimmed = value.trim();
    if (/^data:image\//i.test(trimmed)) return 'PNG';
    if (/^data:application\/pdf/i.test(trimmed)) return 'PDF';
    if (trimmed.startsWith('^XA') || trimmed.includes('^XZ')) return 'ZPL';
    if (trimmed.startsWith('JVBERi0')) return 'PDF';
    if (trimmed.startsWith('iVBOR')) return 'PNG';

      if (looksLikeHttpUrl(trimmed)) {
        if (/\.pdf($|\?)/i.test(trimmed)) return 'PDF';
        if (/\.(png|jpg|jpeg|gif|webp|bmp)($|\?)/i.test(trimmed)) return 'PNG';
      }

      if (isLikelyBase64(trimmed)) {
        if (trimmed.startsWith('JVBERi0')) return 'PDF';
        if (trimmed.startsWith('iVBOR')) return 'PNG';
      }

      return 'UNKNOWN';
  };

  const buildPreviewSource = (format: 'ZPL' | 'PDF' | 'PNG', value: string | null): string | null => {
    if (!value) return null;
    if (looksLikeDataUri(value) || looksLikeHttpUrl(value)) return value;

    const detectedContentType = detectContentType(value);

    if (detectedContentType === 'PDF') {
      return `data:application/pdf;base64,${sanitizeBase64(value)}`;
    }

    if (detectedContentType === 'PNG') {
      return `data:image/png;base64,${sanitizeBase64(value)}`;
    }

    if (format === 'PDF') {
      return `data:application/pdf;base64,${sanitizeBase64(value)}`;
    }

    if (format === 'PNG') {
      return `data:image/png;base64,${sanitizeBase64(value)}`;
    }

    return null;
  };

  const normalizeBase64 = (value: string): string => {
    const cleaned = sanitizeBase64(value).replace(/-/g, '+').replace(/_/g, '/');
    const paddedLength = Math.ceil(cleaned.length / 4) * 4;
    return cleaned.padEnd(paddedLength, '=');
  };

  const extractBase64Body = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.startsWith('data:') && trimmed.includes(',')) {
      return normalizeBase64(trimmed.substring(trimmed.indexOf(',') + 1));
    }
    return normalizeBase64(trimmed);
  };

  const tryDecodeBase64Text = (value: string): string | null => {
    try {
      const binary = atob(extractBase64Body(value));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch {
      return null;
    }
  };

  const toZplText = (rawLabelData: string): string | null => {
    const trimmed = rawLabelData.trim();
    if (trimmed.includes('^XA') || trimmed.includes('^XZ')) {
      return trimmed.replace(/\\r\\n|\\n|\\r/g, '\n');
    }

    const decoded = tryDecodeBase64Text(rawLabelData);
    if (decoded && (decoded.includes('^XA') || decoded.includes('^XZ'))) {
      return decoded.replace(/\r\n|\r/g, '\n');
    }

    try {
      const binary = atob(extractBase64Body(rawLabelData));
      if (binary.includes('^XA') || binary.includes('^XZ')) {
        return binary.replace(/\r\n|\r/g, '\n');
      }
    } catch {
      // no-op
    }

    return null;
  };

  const renderZplWithLabelary = async (zplText: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/labelary-preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, */*',
        },
        body: JSON.stringify({ zpl: zplText }),
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as { imageDataUrl?: unknown };
      return typeof payload.imageDataUrl === 'string' ? payload.imageDataUrl : null;
    } catch {
      return null;
    }
  };

  const renderPdfBase64ToImage = async (pdfBase64: string): Promise<string | null> => {
    try {
      const binary = atob(pdfBase64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const loadingTask = getDocument({ data: bytes });
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) return null;

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return canvas.toDataURL('image/png');
    } catch {
      return null;
    }
  };

  const normalizeByRequestedFormat = async (
    labelFormat: 1 | 2 | 3,
    rawLabelData: string | null
  ): Promise<{ labelData: string | null; labelSrc: string | null; detectedContentType: 'PNG' | 'PDF' | 'ZPL' | 'UNKNOWN' }> => {
    if (!rawLabelData) {
      return { labelData: null, labelSrc: null, detectedContentType: 'UNKNOWN' };
    }

    if (labelFormat === 1) {
      const detectedInZplSlot = detectContentType(rawLabelData);

      if (detectedInZplSlot === 'PDF') {
        const pdfBase64 = extractBase64Body(rawLabelData);
        const pdfPreviewImage = await renderPdfBase64ToImage(pdfBase64);
        return {
          labelData: pdfBase64,
          labelSrc: pdfPreviewImage,
          detectedContentType: pdfPreviewImage ? 'PNG' : 'PDF',
        };
      }

      const zplText = toZplText(rawLabelData) || rawLabelData.trim();
      const hasZplMarkers = zplText.includes('^XA') || zplText.includes('^XZ');
      const labelarySrc = hasZplMarkers ? await renderZplWithLabelary(zplText) : null;

      return {
        labelData: zplText,
        labelSrc: labelarySrc,
        detectedContentType: hasZplMarkers ? 'ZPL' : detectContentType(rawLabelData),
      };
    }

    if (labelFormat === 2) {
      const pdfBase64 = extractBase64Body(rawLabelData);
      const pdfPreviewImage = await renderPdfBase64ToImage(pdfBase64);
      return {
        labelData: pdfBase64,
        labelSrc: pdfPreviewImage,
        detectedContentType: pdfPreviewImage ? 'PNG' : 'UNKNOWN',
      };
    }

    const pngBase64 = extractBase64Body(rawLabelData);
    return {
      labelData: pngBase64,
      labelSrc: `data:image/png;base64,${pngBase64}`,
      detectedContentType: 'PNG',
    };
  };

  const extractLabelData = (format: 'ZPL' | 'PDF' | 'PNG', responseData: unknown): string | null => {
      if (typeof responseData === 'string' && responseData.length > 0) {
        return responseData;
      }

      if (typeof responseData !== 'object' || responseData === null) {
        return null;
      }

      const candidatePaths: Record<'ZPL' | 'PDF' | 'PNG', string[]> = {
        ZPL: [
          'Label.LabelImage',
          'label.LabelImage',
          'labelImage',
          'label',
          'zpl',
          'labelZpl',
          'labelImageZpl',
          'data',
          'data.labelImage',
          'data.label',
          'result.labelImage',
          'result.label',
          'result.zpl',
        ],
        PDF: [
          'Label.LabelImage',
          'label.LabelImage',
          'pdf',
          'labelPdf',
          'labelImagePdf',
          'labelImage',
          'label',
          'data',
          'data.pdf',
          'data.labelPdf',
          'data.labelImage',
          'result.pdf',
          'result.labelPdf',
          'result.labelImage',
        ],
        PNG: [
          'Label.LabelImage',
          'label.LabelImage',
          'png',
          'labelPng',
          'labelImagePng',
          'labelImage',
          'label',
          'data',
          'data.png',
          'data.labelPng',
          'data.labelImage',
          'result.png',
          'result.labelPng',
          'result.labelImage',
        ],
      };

      for (const path of candidatePaths[format]) {
        const value = getNestedValue(responseData, path);
        if (typeof value === 'string' && value.length > 0) {
          return value;
        }
      }

      // Fallback: scan entire response for renderable string payloads.
      const allStrings: string[] = [];
      collectStringValues(responseData, allStrings);

      if (allStrings.length === 0) {
        return null;
      }

      const preferred = allStrings.find((value) => detectContentType(value) === format);
      if (preferred) return preferred;

      const anyRenderable = allStrings.find((value) => detectContentType(value) !== 'UNKNOWN');
      if (anyRenderable) return anyRenderable;

      const likelyLargeBase64 = allStrings.find((value) => isLikelyBase64(value));
      if (likelyLargeBase64) return likelyLargeBase64;

      return null;
    };

  const sendRequest = async () => {
    if (!url.trim()) {
      alert('Please enter a URL');
      return;
    }

    const removeCommentOnlyLines = (input: string): string =>
      input
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('//'))
        .join('\n');

    const stripJsonLineComments = (input: string): string => {
      let output = '';
      let inString = false;
      let escaped = false;

      for (let i = 0; i < input.length; i += 1) {
        const char = input[i];
        const next = input[i + 1];

        if (!inString && char === '/' && next === '/') {
          while (i < input.length && input[i] !== '\n') {
            i += 1;
          }
          if (i < input.length && input[i] === '\n') {
            output += '\n';
          }
          continue;
        }

        output += char;

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === '\\') {
            escaped = true;
          } else if (char === '"') {
            inString = false;
          }
        } else if (char === '"') {
          inString = true;
        }
      }

      return output;
    };

    const normalizeJsonInput = (raw: string): string => {
      const withoutCommentLines = removeCommentOnlyLines(raw);
      const withoutComments = stripJsonLineComments(withoutCommentLines);
      return withoutComments
        .replace(/^\uFEFF/, '')
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/,\s*([}\]])/g, '$1');
    };

    const parseJsonWithHelpfulError = (raw: string, label: string): unknown => {
      const normalized = normalizeJsonInput(raw);

      try {
        return JSON.parse(normalized);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown JSON parse error';
        alert(`${label} JSON parse error: ${message}`);
        throw error;
      }
    };

    let parsedPayload: unknown;
    try {
      parsedPayload = parseJsonWithHelpfulError(payload, 'Payload');
    } catch {
      return;
    }

    let parsedHeaders: Record<string, string> = {};
    try {
      const headerJson = customHeaders.trim();
      if (headerJson.length > 0) {
        const candidate = parseJsonWithHelpfulError(headerJson, 'Headers');
        if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
          alert('Headers must be a JSON object');
          return;
        }

        parsedHeaders = Object.entries(candidate).reduce<Record<string, string>>((acc, [key, value]) => {
          acc[key] = typeof value === 'string' ? value : String(value);
          return acc;
        }, {});
      }
    } catch {
      return;
    }

    const allFormatConfigs: Array<{ format: 'ZPL' | 'PDF' | 'PNG'; labelFormat: 1 | 2 | 3 }> = [
      { format: 'ZPL', labelFormat: 1 },
      { format: 'PDF', labelFormat: 2 },
      { format: 'PNG', labelFormat: 3 },
    ];

    const formatConfigs = allFormatConfigs.filter(({ format }) => selectedFormats[format]);

    if (formatConfigs.length === 0) {
      setFormatSelectionError('Please select a label format');
      return;
    }
    setFormatSelectionError(null);

    const payloadObject =
      typeof parsedPayload === 'object' && parsedPayload !== null
        ? (parsedPayload as Record<string, unknown>)
        : {};

    const findFirstStringByKey = (
      input: unknown,
      keyMatcher: (key: string) => boolean,
      depth = 0
    ): string | null => {
      if (depth > 10 || input == null) return null;

      if (Array.isArray(input)) {
        for (const item of input) {
          const match = findFirstStringByKey(item, keyMatcher, depth + 1);
          if (match) return match;
        }
        return null;
      }

      if (!isObjectRecord(input)) {
        return null;
      }

      for (const [key, value] of Object.entries(input)) {
        if (keyMatcher(key) && typeof value === 'string' && value.trim().length > 0) {
          return value.trim();
        }
      }

      for (const value of Object.values(input)) {
        const match = findFirstStringByKey(value, keyMatcher, depth + 1);
        if (match) return match;
      }

      return null;
    };

    const replaceLabelFormatRecursively = (input: unknown, value: 1 | 2 | 3): unknown => {
      if (Array.isArray(input)) {
        return input.map((item) => replaceLabelFormatRecursively(item, value));
      }

      if (isObjectRecord(input)) {
        const output: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(input)) {
          if (key.toLowerCase() === 'labelformat') {
            output[key] = value;
          } else {
            output[key] = replaceLabelFormatRecursively(val, value);
          }
        }
        return output;
      }

      return input;
    };

    const carrierCode =
      findFirstStringByKey(payloadObject, (key) => key.toLowerCase() === 'carriercode') ||
      'UNKNOWN_CARRIER';

    const normalizedCarrierCode = carrierCode
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'UNKNOWN_CARRIER';

    const newResults: LabelResult[] = formatConfigs.map(({ format, labelFormat }) => ({
      format,
      requestedFormatCode: labelFormat,
      requestId: null,
      labelData: null,
      labelSrc: null,
      detectedContentType: 'UNKNOWN',
      response: null,
      rawResponse: '',
      error: null,
      isLoading: true,
    }));

    setResults(newResults);

    for (const [index, { format, labelFormat }] of formatConfigs.entries()) {
        const counter = String(requestCounterRef.current).padStart(3, '0');
        requestCounterRef.current += 1;
      const requestId = `${normalizedCarrierCode}_Test_${format}_${counter}`;

        const existingLabel =
          isObjectRecord(payloadObject.Label)
            ? payloadObject.Label
            : isObjectRecord(payloadObject.label)
              ? payloadObject.label
              : {};

        const modifiedPayload = {
          ...(replaceLabelFormatRecursively(payloadObject, labelFormat) as Record<string, unknown>),
          Label: {
            ...existingLabel,
            LabelFormat: labelFormat,
            ...(Object.prototype.hasOwnProperty.call(existingLabel, 'LabelImage')
              ? { LabelImage: (existingLabel as Record<string, unknown>).LabelImage }
              : {}),
          },
          ...(Object.prototype.hasOwnProperty.call(payloadObject, 'labelImage')
            ? { labelImage: labelFormat }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(payloadObject, 'labelFormat')
            ? { labelFormat }
            : {}),
          uniqueRequestId: requestId,
          UniqueRequestId: requestId,
          ...(Object.prototype.hasOwnProperty.call(payloadObject, 'requestId')
            ? { requestId }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(payloadObject, 'requestID')
            ? { requestID: requestId }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(payloadObject, 'request_id')
            ? { request_id: requestId }
            : {}),
        };

        try {
          const requestBody = JSON.stringify(modifiedPayload);

          const methodSupportsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(requestMethod);

          const proxyResponse = await fetch('/api/label-proxy', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json, */*',
            },
            body: JSON.stringify({
              method: requestMethod,
              targetUrl: url.trim(),
              payload: methodSupportsBody ? JSON.parse(requestBody) : null,
              headers: {
                ...parsedHeaders,
                'x-request-id': requestId,
              },
              insecureTls: allowInsecureTls,
            }),
          });

          let response = proxyResponse;
          let responseText = await proxyResponse.text();
          let responseData: unknown;

          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }

          const proxyTransportFailed =
            proxyResponse.status === 502 &&
            typeof responseData === 'object' &&
            responseData !== null &&
            typeof (responseData as Record<string, unknown>).error === 'string' &&
            ((responseData as Record<string, unknown>).error as string)
              .toLowerCase()
              .includes('fetch failed');

          if (proxyTransportFailed) {
            try {
              const directResponse = await fetch(url.trim(), {
                method: requestMethod,
                headers: {
                  'Content-Type': 'application/json',
                  Accept: 'application/json, */*',
                  ...parsedHeaders,
                  'x-request-id': requestId,
                },
                ...(methodSupportsBody ? { body: requestBody } : {}),
              });

              response = directResponse;
              responseText = await directResponse.text();
              try {
                responseData = JSON.parse(responseText);
              } catch {
                responseData = responseText;
              }
            } catch (directError) {
              const proxyDetails =
                typeof responseData === 'object' && responseData !== null
                  ? JSON.stringify(responseData)
                  : String(responseData || '');
              const directMessage =
                directError instanceof Error ? directError.message : 'Direct browser request failed';

              setResults((prev) => {
                const updated = [...prev];
                updated[index] = {
                  format,
                  requestedFormatCode: labelFormat,
                  requestId,
                  labelData: null,
                  labelSrc: null,
                  detectedContentType: 'UNKNOWN',
                  response: {
                    proxy: responseData,
                    directError: directMessage,
                  },
                  rawResponse: proxyDetails,
                  error: `Proxy and direct request both failed. Proxy details: ${proxyDetails.slice(0, 400)}${proxyDetails.length > 400 ? '...' : ''}`,
                  isLoading: false,
                };
                return updated;
              });
              continue;
            }
          }

          if (!response.ok) {
            setResults((prev) => {
              const updated = [...prev];
              updated[index] = {
                format,
                requestedFormatCode: labelFormat,
                requestId,
                labelData: null,
                labelSrc: null,
                detectedContentType: 'UNKNOWN',
                response: responseData,
                rawResponse: responseText,
                error: `HTTP ${response.status}: ${response.statusText}${responseText ? ` - ${responseText.slice(0, 200)}` : ''}`,
                isLoading: false,
              };
              return updated;
            });
            continue;
          }

          const explicitLabelImage = getNestedValue(responseData, 'Label.LabelImage');
          const explicitLabelImageLower = getNestedValue(responseData, 'label.labelImage');
          const recursiveLabelImages: unknown[] = [];
          collectValuesByKeyName(
            responseData,
            (key) => key.toLowerCase() === 'labelimage',
            recursiveLabelImages
          );

          const recursiveLabelImage = recursiveLabelImages.find((value) => typeof value === 'string');
          const rawLabelData =
            typeof explicitLabelImage === 'string' && explicitLabelImage.length > 0
              ? explicitLabelImage
              : typeof explicitLabelImageLower === 'string' && explicitLabelImageLower.length > 0
                ? explicitLabelImageLower
                : typeof recursiveLabelImage === 'string' && recursiveLabelImage.length > 0
                  ? recursiveLabelImage
              : extractLabelData(format, responseData);
          const normalized = await normalizeByRequestedFormat(labelFormat, rawLabelData);

          setResults((prev) => {
            const updated = [...prev];
            updated[index] = {
              format,
              requestedFormatCode: labelFormat,
              requestId,
              labelData: normalized.labelData,
              labelSrc: normalized.labelSrc || buildPreviewSource(format, rawLabelData),
              detectedContentType: normalized.detectedContentType,
              response: responseData,
              rawResponse: responseText,
              error: null,
              isLoading: false,
            };
            return updated;
          });
        } catch (err) {
          setResults((prev) => {
            const updated = [...prev];
            updated[index] = {
              format,
              requestedFormatCode: labelFormat,
              requestId,
              labelData: null,
              labelSrc: null,
              detectedContentType: 'UNKNOWN',
              response: null,
              rawResponse: '',
              error:
                err instanceof Error
                  ? err.message.includes('Failed to fetch')
                    ? 'Network error. Configure Headers, Proxy URL, or Enable insecure TLS (dev only), then retry.'
                    : err.message
                  : 'Request failed',
              isLoading: false,
            };
            return updated;
          });
        }
    }
  };

  const toggleResponse = (key: string) => {
    setExpandedResponses((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const copyToClipboard = async (text: string, identifier: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(identifier);
      setTimeout(() => setCopySuccess(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const downloadLabel = (labelData: string, format: string) => {
    if (!labelData) return;

    const mimeType = format === 'PDF' ? 'application/pdf' : 'image/png';
    const isBase64 = labelData.length > 200;

    if (format === 'ZPL' || !isBase64) {
      const blob = new Blob([labelData], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `label.${format === 'ZPL' ? 'zpl' : 'txt'}`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const byteCharacters = atob(labelData);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `label.${format === 'PDF' ? 'pdf' : 'png'}`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const formatIcon = (format: string) => {
    switch (format) {
      case 'ZPL':
        return <Code className="w-5 h-5" />;
      case 'PDF':
        return <FileText className="w-5 h-5" />;
      case 'PNG':
        return <Image className="w-5 h-5" />;
      default:
        return null;
    }
  };

  const formatTitle = (format: string) => {
    switch (format) {
      case 'ZPL':
        return 'ZPL Label (Format 1)';
      case 'PDF':
        return 'PDF Label (Format 2)';
      case 'PNG':
        return 'PNG Label (Format 3)';
      default:
        return format;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-maersk-dark text-white shadow-lg">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-white p-2 rounded-lg">
                <Ship className="w-8 h-8 text-maersk-dark" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Carrier Label Testing Tool
                </h1>
                <p className="text-maersk-300 text-sm">
                  A.P. Moller Maersk - E-commerce Logistics
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm text-maersk-300">
              <span className="px-3 py-1 bg-maersk-700 rounded-full">
                QA Engineer Dashboard
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel - Input */}
          <div className="space-y-6">
            {/* URL Input */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-maersk-primary px-4 py-3 border-b border-maersk-700">
                <h2 className="text-white font-semibold flex items-center gap-2">
                  <span className="w-2 h-2 bg-maersk-accent rounded-full"></span>
                  API Endpoint
                </h2>
              </div>
              <div className="p-4">
                <div className="flex gap-3">
                  <select
                    value={requestMethod}
                    onChange={(e) => setRequestMethod(e.target.value as HttpMethod)}
                    className="w-32 px-3 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-maersk-accent focus:border-transparent font-mono text-sm text-gray-800"
                    aria-label="HTTP method"
                  >
                    {supportedMethods.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Enter the label generation API endpoint..."
                    className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-maersk-accent focus:border-transparent font-mono text-sm text-gray-800 placeholder-gray-400"
                  />
                </div>
              </div>
            </div>

            {/* Payload Input */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
              <div className="bg-maersk-primary px-4 py-3 border-b border-maersk-700">
                <div className="flex items-center justify-between">
                  <h2 className="text-white font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 bg-maersk-accent rounded-full"></span>
                    Request Payload (JSON)
                  </h2>
                  <span className="text-xs text-maersk-300">
                    labelImage will be added automatically
                  </span>
                </div>
              </div>
              <div className="px-4 pt-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Additional Request Headers (JSON)
                  </label>
                  <textarea
                    value={customHeaders}
                    onChange={(e) => setCustomHeaders(e.target.value)}
                    placeholder='{"Authorization":"Bearer YOUR_TOKEN"}'
                    className="w-full h-24 px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-maersk-accent focus:border-transparent font-mono text-sm text-gray-800 placeholder-gray-400 resize-y"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="flex items-end">
                    <label className="w-full px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 cursor-pointer text-sm text-amber-800">
                      <input
                        type="checkbox"
                        checked={allowInsecureTls}
                        onChange={(e) => setAllowInsecureTls(e.target.checked)}
                        className="accent-amber-600"
                      />
                      Enable insecure TLS (dev only)
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Label Formats To Generate
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['ZPL', 'PDF', 'PNG'] as const).map((format) => (
                      <label
                        key={format}
                        className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-2 cursor-pointer text-sm text-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFormats[format]}
                          onChange={() => toggleFormatSelection(format)}
                          className="accent-maersk-accent"
                        />
                        {format}
                      </label>
                    ))}
                  </div>
                  {formatSelectionError && (
                    <p className="mt-2 text-sm text-red-600">{formatSelectionError}</p>
                  )}
                </div>
              </div>
              <div className="p-4 flex-1">
                <div className="h-80 bg-gray-50 border border-gray-200 rounded-lg overflow-hidden flex focus-within:ring-2 focus-within:ring-maersk-accent focus-within:border-transparent">
                  <div
                    ref={payloadGutterRef}
                    className="w-14 bg-gray-100 border-r border-gray-200 text-gray-400 text-right font-mono text-[13px] leading-[24px] py-3 px-2 overflow-hidden select-none"
                    aria-hidden="true"
                  >
                    {payloadLineNumbers.map((lineNumber) => (
                      <div
                        key={lineNumber}
                        className={lineNumber === currentPayloadLine ? 'text-maersk-accent font-semibold' : ''}
                      >
                        {lineNumber}
                      </div>
                    ))}
                  </div>
                  <div className="relative w-full h-full">
                    <div
                      ref={payloadHighlightRef}
                      className="absolute inset-0 px-4 py-3 overflow-hidden pointer-events-none font-mono text-[13px] leading-[24px] whitespace-pre"
                      aria-hidden="true"
                    >
                      {payload.split('\n').map((line, lineIndex) => (
                        <div
                          key={`line-${lineIndex + 1}`}
                          className={lineIndex + 1 === currentPayloadLine ? 'bg-maersk-50/80' : ''}
                        >
                          {renderJsonHighlightedLine(line)}
                          {line.length === 0 ? ' ' : ''}
                        </div>
                      ))}
                    </div>
                    <textarea
                      ref={payloadTextareaRef}
                      value={payload}
                      onChange={(e) => setPayload(e.target.value)}
                      onScroll={syncPayloadGutterScroll}
                      onClick={updateCurrentPayloadLine}
                      onKeyUp={updateCurrentPayloadLine}
                      onSelect={updateCurrentPayloadLine}
                      onFocus={updateCurrentPayloadLine}
                      onKeyDown={handlePayloadKeyDown}
                      placeholder="Enter your JSON payload here..."
                      className="relative z-10 w-full h-full px-4 py-3 bg-transparent focus:outline-none font-mono text-[13px] leading-[24px] text-transparent caret-gray-800 placeholder-gray-400 resize-none whitespace-pre overflow-auto"
                      wrap="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
              </div>
              <div className="px-4 pb-4">
                <button
                  onClick={sendRequest}
                  className="w-full bg-maersk-accent hover:bg-maersk-400 text-white font-semibold py-4 px-6 rounded-lg transition-all duration-200 flex items-center justify-center gap-3 shadow-md hover:shadow-lg active:scale-[0.98]"
                >
                  <Send className="w-5 h-5" />
                  Generate Selected Labels
                </button>
              </div>
            </div>
          </div>

          {/* Right Panel - Results */}
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-maersk-dark font-bold text-lg flex items-center gap-2">
                <Ship className="w-5 h-5 text-maersk-accent" />
                Label Results
              </h2>
              <span className="text-sm text-gray-500">
                ZPL, PDF, and PNG formats
              </span>
            </div>

            {results.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
                <div className="w-16 h-16 bg-maersk-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Image className="w-8 h-8 text-maersk-400" />
                </div>
                <p className="text-gray-500 mb-2">No labels generated yet</p>
                <p className="text-sm text-gray-400">
                  Enter an API endpoint and payload, then click "Generate Labels"
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {results.map((result) => (
                  <div
                    key={result.format}
                    className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
                  >
                    {/* Card Header */}
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-maersk-50 to-white">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-maersk-primary rounded-lg text-white">
                          {formatIcon(result.format)}
                        </div>
                        <div>
                          <h3 className="font-semibold text-maersk-dark">
                            {formatTitle(result.format)}
                          </h3>
                          <p className="text-xs text-gray-500">
                          Requested label format: {result.requestedFormatCode} | Request ID: {result.requestId || 'pending'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {result.isLoading ? (
                          <span className="flex items-center gap-2 text-maersk-accent text-sm">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Processing...
                          </span>
                        ) : result.error ? (
                          <span className="flex items-center gap-2 text-red-500 text-sm bg-red-50 px-3 py-1 rounded-full">
                            <AlertCircle className="w-4 h-4" />
                            Error
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 text-maersk-success text-sm bg-green-50 px-3 py-1 rounded-full">
                            <CheckCircle className="w-4 h-4" />
                            Success
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Card Content */}
                    <div className="p-4">
                      {result.isLoading ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                          <Loader2 className="w-10 h-10 animate-spin text-maersk-accent mb-4" />
                          <p>Generating {result.format} label...</p>
                        </div>
                      ) : result.error ? (
                        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                          <p className="text-red-700 font-medium mb-2">{result.error}</p>
                          <p className="text-red-600 text-sm">
                            Check the API endpoint and payload, then try again.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Label Preview */}
                          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                                Label Preview
                              </span>
                              <button
                                onClick={() => downloadLabel(result.labelData || '', result.format)}
                                className="flex items-center gap-1 text-xs text-maersk-accent hover:text-maersk-600 transition-colors"
                              >
                                <Download className="w-3 h-3" />
                                Download
                              </button>
                            </div>
                            <div className="min-h-48 bg-white border border-gray-100 rounded flex items-center justify-center overflow-hidden">
                              {(result.detectedContentType === 'PNG' || (result.labelSrc?.startsWith('data:image/') ?? false) || ((result.labelSrc?.startsWith('http://') || result.labelSrc?.startsWith('https://')) && result.detectedContentType !== 'PDF')) && result.labelSrc ? (
                                <img
                                  src={result.labelSrc}
                                  alt="Label"
                                  className="max-w-full max-h-80 object-contain"
                                  onError={(e) => {
                                    const target = e.target as HTMLImageElement;
                                    target.style.display = 'none';
                                    target.parentElement!.innerHTML = `
                                      <div class="text-gray-400 text-center p-4">
                                        <p class="mb-2">Unable to render image</p>
                                        <p class="text-xs">Raw base64 data available in response</p>
                                      </div>
                                    `;
                                  }}
                                />
                              ) : (
                                <div className="text-center p-4">
                                  <Code className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                                  <p className="text-gray-500 text-sm mb-2">
                                    {result.format === 'ZPL'
                                      ? 'ZPL code rendered below'
                                      : 'Label data available in response'}
                                  </p>
                                  {result.format === 'PDF' && !result.labelSrc && (
                                    <p className="text-xs text-amber-600 mb-2">
                                      PDF preview conversion failed. Response is available in View Response.
                                    </p>
                                  )}
                                  {result.labelData && (result.detectedContentType === 'ZPL' || result.format === 'ZPL') && (
                                    <pre className="bg-gray-800 text-green-400 p-4 rounded text-xs text-left overflow-x-auto max-h-40 custom-scrollbar">
                                      {result.labelData.substring(0, 1000)}
                                      {result.labelData.length > 1000 && '...'}
                                    </pre>
                                  )}
                                  {result.labelData && result.detectedContentType !== 'ZPL' && !result.labelSrc && (
                                    <p className="text-xs text-amber-600">
                                      Response received (detected: {result.detectedContentType}), but preview format is not directly renderable. Check View Response.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Response Section */}
                          <div>
                            <button
                              onClick={() => toggleResponse(result.format)}
                              className="w-full flex items-center justify-between px-4 py-2 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors text-sm"
                            >
                              <span className="font-medium text-gray-700">View Response</span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copyToClipboard(result.rawResponse, result.format);
                                  }}
                                  className="p-1 hover:bg-gray-200 rounded transition-colors"
                                  title="Copy response"
                                >
                                  {copySuccess === result.format ? (
                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                  ) : (
                                    <Copy className="w-4 h-4 text-gray-400" />
                                  )}
                                </button>
                                {expandedResponses[result.format] ? (
                                  <ChevronUp className="w-4 h-4 text-gray-500" />
                                ) : (
                                  <ChevronDown className="w-4 h-4 text-gray-500" />
                                )}
                              </div>
                            </button>
                            {expandedResponses[result.format] && (
                              <div className="mt-2 bg-gray-900 rounded-lg p-4 max-h-64 overflow-auto custom-scrollbar">
                                <pre className="text-green-400 text-xs whitespace-pre-wrap break-words">
                                  {JSON.stringify(result.response, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 px-6 py-4 mt-8">
        <div className="flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <Ship className="w-4 h-4 text-maersk-accent" />
            <span>A.P. Moller Maersk</span>
          </div>
          <div>Carrier Label Testing Tool v1.0</div>
        </div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1f2937;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #4b5563;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }
      `}</style>
    </div>
  );
}

export default App;
