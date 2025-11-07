export function getMedian(arr) {
    if (arr.length === 0) {
        return 0;
    }
    const sortedArr = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sortedArr.length / 2);

    if (sortedArr.length % 2 === 0) {
        return (sortedArr[mid - 1] + sortedArr[mid]) / 2;
    } else {
        return sortedArr[mid];
    }
}

export function getStandardDeviation(arr) {
    if (arr.length === 0) {
        return 0;
    }

    const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;

    const sumOfSquaredDifferences = arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0);

    const variance = sumOfSquaredDifferences / (arr.length - 1);

    return Math.sqrt(variance);
}