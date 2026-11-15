import httpx
import pytest

from app.core.config import settings
from app.services.llm.client import LLMClient
from app.services.rag.qa import answer_question


@pytest.fixture
def mock_model(monkeypatch):
    original_client = httpx.AsyncClient
    monkeypatch.setattr(settings, "llm_api_key", "test-key")
    monkeypatch.setattr(settings, "llm_base_url", "https://model.example.test")

    def install(handler):
        monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))

    return install


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["timeout", "connect", "http", "json", "empty_choices", "bad_message", "non_text"])
async def test_chat_text_failure_returns_empty_for_existing_evidence_fallback(mock_model, failure):
    def handler(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("timed out", request=request)
        if failure == "connect":
            raise httpx.ConnectError("offline", request=request)
        if failure == "http":
            return httpx.Response(503, json={"error": "unavailable"})
        if failure == "json":
            return httpx.Response(200, text="not JSON")
        payload = {"choices": []} if failure == "empty_choices" else {
            "choices": [{"message": [] if failure == "bad_message" else {"content": [{"text": "unexpected"}]}}],
        }
        return httpx.Response(200, json=payload)

    mock_model(handler)
    assert await LLMClient().chat_text("system", "question") == ""


@pytest.mark.asyncio
async def test_chat_text_valid_response_is_preserved(mock_model):
    mock_model(lambda request: httpx.Response(200, json={"choices": [{"message": {"content": "有依据的回答。[1]"}}]}))
    assert await LLMClient().chat_text("system", "question") == "有依据的回答。[1]"


@pytest.mark.asyncio
async def test_rag_model_timeout_still_returns_evidence_and_citation(mock_model, monkeypatch):
    def timeout(request):
        raise httpx.ReadTimeout("timed out", request=request)

    mock_model(timeout)
    monkeypatch.setattr(settings, "rag_llm_enabled", True)
    monkeypatch.setattr("app.services.rag.qa.search_similar_documents", lambda *args, **kwargs: [{
        "id": "one", "source_id": "source", "source_type": "knowledge_file", "title": "请假说明",
        "snippet": "申请年假需要先提交主管审批。", "score": 0.9,
    }])
    result = await answer_question(object(), "00000000-0000-0000-0000-000000000001", "如何申请年假？")
    assert result["generation_mode"] == "extractive"
    assert result["retrieval_count"] == 1
    assert "主管审批" in result["answer"] and "[1]" in result["answer"]
