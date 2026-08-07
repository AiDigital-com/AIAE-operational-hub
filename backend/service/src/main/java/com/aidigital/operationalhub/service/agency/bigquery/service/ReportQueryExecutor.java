package com.aidigital.operationalhub.service.agency.bigquery.service;

import com.aidigital.operationalhub.externalservices.bigquery.BigQueryOperationContext;
import org.springframework.stereotype.Component;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

/**
 * Runs the independent totals or count half of an interactive report or dashboard read alongside its
 * page query.
 *
 * <p>The pool and its queue are deliberately bounded. When both are full,
 * {@link ThreadPoolExecutor.CallerRunsPolicy} executes the totals read on the request thread: an overloaded
 * instance becomes sequential instead of accumulating unbounded work or rejecting a valid report. BigQuery
 * operation attribution is copied to the worker and restored afterward because it is thread-local.
 */
@Component
public class ReportQueryExecutor implements AutoCloseable {

	private static final int MAX_PARALLELISM = 4;
	private static final int QUEUE_PER_WORKER = 8;
	private static final AtomicInteger THREAD_SEQUENCE = new AtomicInteger();

	private final BigQueryOperationContext operationContext;
	private final ExecutorService executor;

	/**
	 * Creates the production executor sized for this JVM.
	 *
	 * @param operationContext current BigQuery operation attribution
	 */
	public ReportQueryExecutor(BigQueryOperationContext operationContext) {
		this.operationContext = operationContext;
		this.executor = newExecutor();
	}

	/**
	 * Submits one interactive read while retaining the caller's BigQuery operation label.
	 *
	 * @param task read to execute
	 * @param <T>  result type
	 * @return future completed with the read result or failure
	 */
	public <T> CompletableFuture<T> submit(Supplier<T> task) {
		String operation = operationContext.current();
		return CompletableFuture.supplyAsync(() -> withOperation(operation, task), executor);
	}

	/**
	 * Waits for a submitted read and preserves its original runtime failure type.
	 *
	 * @param future submitted read
	 * @param <T>    result type
	 * @return completed result
	 */
	public <T> T await(CompletableFuture<T> future) {
		try {
			return future.join();
		} catch (CompletionException exception) {
			if (exception.getCause() instanceof RuntimeException runtimeException) {
				throw runtimeException;
			}
			throw exception;
		}
	}

	private <T> T withOperation(String operation, Supplier<T> task) {
		String previous = operationContext.current();
		operationContext.set(operation);
		try {
			return task.get();
		} finally {
			if (BigQueryOperationContext.UNLABELLED.equals(previous)) {
				operationContext.clear();
			} else {
				operationContext.set(previous);
			}
		}
	}

	private static ExecutorService newExecutor() {
		int parallelism = Math.max(2, Math.min(MAX_PARALLELISM,
				Runtime.getRuntime().availableProcessors() * 2));
		return new ThreadPoolExecutor(
				parallelism,
				parallelism,
				0L,
				TimeUnit.MILLISECONDS,
				new ArrayBlockingQueue<>(parallelism * QUEUE_PER_WORKER),
				runnable -> {
					Thread thread = new Thread(runnable);
					thread.setName("report-query-" + THREAD_SEQUENCE.incrementAndGet());
					thread.setDaemon(true);
					return thread;
				},
				new ThreadPoolExecutor.CallerRunsPolicy());
	}

	/**
	 * Stops worker threads during application shutdown.
	 */
	@Override
	public void close() {
		executor.shutdownNow();
	}
}
